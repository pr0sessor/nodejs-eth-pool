const async = require('async')
const bignum = require('bignum')
const io = require('socket.io-client')

const logger = require('./logger')
const utils = require('./utils')
const rpc = require('./rpc')

const config = require('../config')

const { Candidate, Block, Reward } = require('../models')

const socket = io(`http://${config.socket.host}:${config.socket.port}`)

socket.on('connect_error', () => {
  logger('error', 'socket', 'Connection to socket.io server failed')
  process.exit()
})

function pending () {
  logger('info', 'unlocker', 'Started')
  async.waterfall([

    // Get all block candidates
    function (callback) {
      Candidate.find({}, (err, blocks) => {
        if (err) return callback(new Error(`Error trying to get candidate blocks from database ${[err]}`))
        if (blocks.length === 0) return callback(new Error('No candidate blocks in database'))
        callback(null, blocks)
      })
    },

    // Get latest block & filter immature block
    function (blocks, callback) {
      rpc('eth_getBlockByNumber', ['latest', false], (err, result) => {
        if (err) return callback(new Error(`Error trying to get latest block from blockchain: ${err.message}`))
        blocks = blocks.filter(block => parseInt(result.number) - block.number >= config.unlocker.immatureDepth)
        callback(null, blocks)
      })
    },

    // Check if blocks are orphaned
    function (blocks, callback) {
      async.filter(blocks, (block, mapCback) => {
        const poolAddress = config.stratumServer.poolAddress
        let type = 'main'
        let status = 'immature'
        let reward = bignum(utils.toWei('2'))
        rpc('eth_getBlockByNumber', [utils.numberToHex(block.number), true], (err, blockInfo) => {
          if (err) {
            logger('error', 'unlocker', `Error trying to get block from blockchain: ${err.message}`)
            return mapCback(null, false)
          }
          if (blockInfo.miner.toLowerCase() !== poolAddress.toLowerCase()) {
            if (blockInfo.nonce !== block.nonce) {
              type = 'uncle'
              reward = bignum(utils.toWei('1.75'))
            } else {
              status = 'orphan'
            }
          }
          if (status === 'immature') {
            if (blockInfo.uncles.length > 0) {
              reward = reward.add((bignum(blockInfo.uncles.length).div(32)).mul(reward))
            }
            reward = reward.add(bignum(utils.toWei(Number(blockInfo.gasUsed).toString(), 'gwei')))
            const fee = ((block.solo ? config.unlocker.soloFee : config.unlocker.fee) / 100) * Number(reward)

            logger('info', 'unlocker', `[Unlocker] Immature ${(type === 'main' ? 'block' : 'uncle block')}: #${block.number} | Reward: ${parseInt(reward)}`)
            Object.assign(block, {
              hash: blockInfo.hash,
              difficulty: blockInfo.difficulty,
              minerReward: Number(reward) - Number(fee),
              status,
              type,
              reward
            })
          } else {
            logger('error', 'unlocker', `[Unlocker] Block #${block.number} was orphaned`)
            Object.assign(block, {
              status
            })
          }
          return mapCback(true)
        })
      }, function (blocks) {
        if (blocks.length === 0) return callback(new Error('No pending blocks have been verified yet'))
        callback(null, blocks)
      })
    },

    // Handle blocks
    function (blocks, callback) {
      const balances = []
      blocks.forEach(block => {
        const blockData = {
          address: block.address,
          number: block.number,
          nonce: block.nonce,
          solo: block.solo,
          totalShares: block.totalShares,
          round: block.round,
          status: block.status,
          createdAt: block.createdAt
        }
        let minerReward = Number(block.minerReward)
        let minerShare = 0
        if (block.status === 'immature') {
          if (block.solo) {
            if (!balances[block.address]) {
              balances[block.address] = { amount: minerReward, number: block.number }
            } else {
              balances[block.address].amount += minerReward
            }
          } else {
            if (config.unlocker.minerShare > 0) {
              minerShare = config.unlocker.minerShare / 100 * minerReward
              minerReward -= minerShare
            }

            block.round.forEach(share => {
              const amount = (share.difficulty / block.totalShares) * minerReward
              if (!balances[share.address]) {
                balances[share.address] = { amount, number: block.number }
              } else {
                balances[share.address].amount += amount
              }
            })

            if (minerShare > 0) {
              balances[block.address].amount += minerShare
            }
          }
        }
        Object.assign(blockData, {
          hash: block.hash,
          reward: Number(block.reward),
          minerReward: Number(block.minerReward),
          difficulty: block.difficulty,
          type: block.type
        })
        Block.create(blockData)
        block.remove()
      })
      Object.keys(balances).forEach(address => {
        socket.emit('immature_update', {
          amount: balances[address].amount,
          number: balances[address].number,
          address
        }, config.socket.key)
      })
      callback(null)
    }
  ], function (err) {
    if (err) logger('warn', 'unlocker', err.message)
    setTimeout(immature, 5000)
  })
}

function immature () {
  async.waterfall([

    // Get all block candidates
    function (callback) {
      Block.find({ status: 'immature' }, (err, blocks) => {
        if (err) return callback(new Error(`Error trying to get immature blocks from database: ${err.message}`))
        if (blocks.length === 0) return callback(new Error('No immature blocks in database'))
        callback(null, blocks)
      })
    },

    // Get latest block & filter unlockable blocks
    function (blocks, callback) {
      rpc('eth_getBlockByNumber', ['latest', false], function (err, result) {
        if (err) return callback(new Error(`Error trying to get latest block from blockchain: ${err.message}`))
        blocks = blocks.filter(block => parseInt(result.number) - block.number >= config.unlocker.depth)
        callback(null, blocks)
      })
    },

    // Handle blocks
    function (blocks, callback) {
      if (blocks.length === 0) return logger('warn', 'unlocker', 'No blocks have reached maturity')
      blocks.forEach((block) => {
        Reward.updateMany({ number: block.number }, { status: 'pending' }, (err) => {
          if (err) return callback(err)
          Reward.create({
            address: config.unlocker.address,
            amount: Number(block.reward) - Number(block.minerReward),
            number: block.number,
            status: 'pending'
          }, (err2) => {
            if (err2) return callback(err2)
            logger('info', 'unlocker', `[Unlocker] ${(block.type === 'main' ? 'Block' : 'Uncle block')}: #${block.number} has been unlocked | Miner Reward: ${block.minerReward} | Fee: ${Number(block.reward) - Number(block.minerReward)}`)
            Object.assign(block, {
              status: 'unlocked'
            }).save()
          })
        })
      })
      callback(null)
    }
  ], function (err) {
    if (err) logger('warn', 'unlocker', err.message)
    logger('success', 'unlocker', 'Finished')
  })
}

pending()
setInterval(pending, config.unlocker.interval * 1000)
