const moment = require('moment')
const logger = require('./logger')
const rpc = require('./rpc')
const utils = require('./utils')
const deasync = require('deasync')
const bignum = require('bignum')

const config = require('../config')

const { Reward, Miner, Block, Hashrate, Payout, Candidate } = require('../models')

const networkStats = (cb) => {
  rpc('eth_getBlockByNumber', ['latest', false], (err, block) => {
    if (err) return logger('error', 'upstream', 'Failed to get latest block number')
    const difficulty = utils.hexToNumber(block.difficulty)
    cb(null, {
      height: utils.hexToNumber(block.number),
      difficulty,
      hashrate: parseInt(difficulty / config.blockTime)
    })
  })
}

const getPoolStats = async (cb) => {
  const stats = {
    hashrate: 0,
    miners: 0,
    fee: config.unlocker.fee,
    soloFee: config.unlocker.soloFee,
    lastBlockFound: 0,
    network: null,
    payout: {
      threshold: config.payout.threshold,
      interval: config.payout.interval
    }
  }
  // network stats
  networkStats((err, res) => {
    if (err) logger('error', 'api', err.message)
    stats.network = res
  })
  deasync.loopWhile(() => { return !stats.network })

  // pool hashrate
  const dbShare = await Hashrate.find({ createdAt: { $gt: new Date(Date.now() - (600 * 1000)) } })
  if (dbShare) {
    let totalShares = 0
    dbShare.forEach((share) => {
      totalShares += Number(share.difficulty)
    })
    stats.hashrate = parseInt(totalShares / 600)
  }

  // online miners
  const dbMiner = await Miner.find({ status: 'online' })
  if (dbMiner) {
    stats.miners = dbMiner.length
  }

  // last block
  const block = await Block.findOne({}, null, { sort: { createdAt: -1 } })
  if (block) {
    stats.lastBlockFound = moment(block.createdAt).unix()
  }
  cb(stats)
}

const getMinerStats = async (address, cb) => {
  const stats = {
    address: '',
    immature: 0,
    pending: 0,
    paid: 0,
    hashrate: 0,
    blocksFound: 0,
    miners: [],
    payments: []

  }

  if (!address) return cb(new Error('Not found'))

  stats.address = address

  // Balance
  const dbRewards = await Reward.find({ address })
  if (!dbRewards) return cb(new Error('Not found'))
  let immature = 0; let pending = 0; let paid = 0
  dbRewards.forEach(reward => {
    if (reward.status === 'immature') immature += Number(reward.amount)
    if (reward.status === 'pending') pending += Number(reward.amount)
    if (reward.status === 'paid') paid += Number(reward.amount)
  })
  stats.immature = bignum(immature).toString()
  stats.pending = bignum(pending).toString()
  stats.paid = bignum(paid).toString()

  // Hashrate
  const dbShare = await Hashrate.find({ createdAt: { $gt: new Date(Date.now() - (600 * 1000)) }, address })
  if (dbShare) {
    let totalShares = 0
    dbShare.forEach(share => {
      totalShares += Number(share.difficulty)
    })
    stats.hashrate = parseInt(totalShares / 600)
  }

  // Blocks
  const dbBlock = await Block.find({ address, status: { $ne: 'orphan' } })
  if (dbBlock) {
    stats.blocksFound = dbBlock.length
  }

  // Miners
  const dbMiner = await Miner.find({ address, status: 'online' })
  if (dbMiner) {
    stats.miners = await Promise.all(dbMiner.map(async miner => {
      const dbShare = await Hashrate.find({ createdAt: { $gt: new Date(Date.now() - (600 * 1000)) }, address, workerName: miner.workerName })
      let totalShares = 0
      if (dbShare) {
        dbShare.forEach(share => {
          totalShares += Number(share.difficulty)
        })
      }
      return {
        hashrate: parseInt(totalShares / 600),
        shares: miner.shares,
        name: miner.workerName,
        lastShare: miner.lastShare
      }
    }))
  }

  // Payments
  const dbPayment = await Payout.find({ address, status: 'paid' }, null, { sort: { datePaid: -1 } })
  if (dbPayment) {
    stats.payments = dbPayment.map(payment => {
      return {
        amount: payment.amount,
        datePaid: payment.datePaid,
        hash: payment.hash
      }
    })
  }
  cb(null, stats)
}

const getPoolBlocks = async (cb) => {
  let candidates = await Candidate.find({}, null, { sort: { createdAt: -1 } })
  candidates = candidates.map(block => {
    return {
      number: block.number,
      solo: block.solo,
      reward: block.reward,
      totalShares: block.totalShares,
      status: 'pending',
      miner: block.address,
      found: block.createdAt
    }
  })
  let blocks = await Block.find({ status: { $ne: 'orphan' } }, null, { sort: { createdAt: -1 } })
  blocks = blocks.map(block => {
    return {
      number: block.number,
      solo: block.solo,
      reward: block.reward,
      totalShares: block.totalShares,
      difficulty: block.difficulty,
      status: block.status,
      miner: block.address,
      hash: block.hash,
      uncle: block.type === 'uncle',
      found: block.createdAt
    }
  })
  let allBlocks = [...candidates, ...blocks]
  allBlocks = allBlocks.sort((a, b) => Number(b.number) - Number(a.number))
  cb(allBlocks)
}

const getPoolPayments = async (cb) => {
  const payments = await Payout.find({ status: 'paid' }, null, { sort: { datePaid: -1 } })
  cb(payments)
}

const getPoolMiners = async (cb) => {
  const miners = await Miner.find({})
  const users = []
  miners.forEach(miner => {
    if (!users.includes(miner.address)) users.push(miner.address)
  })
  let list = []
  if (users) {
    list = await Promise.all(users.map(async address => {
      const tempUser = {
        address: '',
        hashrate: 0,
        miners: 0,
        lastShare: null,
        status: 'offline'
      }
      tempUser.address = address
      const dbMiner = await Miner.find({ address })
      if (dbMiner) {
        const tempMiners = await Promise.all(dbMiner.map(async miner => {
          const dbShare = await Hashrate.find({ createdAt: { $gt: new Date(Date.now() - (600 * 1000)) }, address, workerName: miner.workerName })
          let totalShares = 0
          if (dbShare) {
            dbShare.forEach(share => {
              totalShares += Number(share.difficulty)
            })
          }
          return {
            hashrate: parseInt(totalShares / 600),
            lastShare: (miner.lastShare ? moment(miner.lastShare * 1000).toDate() : null),
            status: miner.status
          }
        }))
        if (tempMiners.length > 0) {
          tempUser.miners = tempMiners.filter(miner => miner.status === 'online').length
          tempUser.hashrate = tempMiners.reduce((a, b) => a + (b.hashrate || 0), 0)
          tempUser.lastShare = (tempMiners.length > 0 ? tempMiners.sort((a, b) => moment(b.lastShare).unix() - moment(a.lastShare).unix())[0].lastShare : null)
          tempUser.status = (tempMiners.filter(miner => miner.status === 'online').length > 0 ? 'online' : 'offline')
        }
        return tempUser
      }
    }))
  }
  cb(list)
}

module.exports = {
  networkStats,
  getPoolStats,
  getMinerStats,
  getPoolBlocks,
  getPoolPayments,
  getPoolMiners
}
