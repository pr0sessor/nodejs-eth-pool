const moment = require('moment')
const bodyParser = require('body-parser')
const express = require('express')
const fs = require('fs')
const http = require('http')
const https = require('https')
const cors = require('cors')
const deasync = require('deasync')

const catchAsync = require('./catchAsync')
const logger = require('./logger')
const api = require('./apiFunctions')

const config = require('../config')

const { Miner, Balance, Block, Hashrate, Payout } = require('../models')

// API server
const app = express()
app.use(bodyParser.json())
app.use(cors())

// GET
app.get('/api/stats', catchAsync(async (req, res) => {
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
  api.networkStats((err, res) => {
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
  res.json(stats).end()
}))

app.get('/api/accounts/:address', catchAsync(async (req, res) => {
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

  const { address } = req.params
  if (!address) return res.status(404).json({ error: 'Not found' }).end()

  stats.address = address

  // Balance
  const dbUser = await Balance.findOne({ address })
  if (!dbUser) return res.status(404).json({ error: 'Not found' }).end()
  stats.immature = dbUser.immature
  stats.pending = dbUser.pending
  stats.paid = dbUser.paid

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
    stats.miners = stats.miners.reduce((miner, current) => {
      const x = miner.find(info => info.name === current.name)
      if (!x) {
        return miner.concat([current])
      } else {
        return miner
      }
    }, [])
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
  res.json(stats).end()
}))

app.get('/api/blocks', catchAsync(async (req, res) => {
  const blocks = await Block.find({ status: { $ne: 'orphan' } }, null, { sort: { createdAt: -1 } })
  res.json(blocks.map(block => {
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
  })).end()
}))

app.get('/api/payments', catchAsync(async (req, res) => {
  const payments = await Payout.find({ status: 'paid' }, null, { sort: { datePaid: -1 } })
  res.json(payments.map(payment => {
    return {
      address: payment.address,
      amount: payment.amount,
      hash: payment.hash,
      datePaid: payment.datePaid
    }
  })).end()
}))

app.get('/api/miners', catchAsync(async (req, res) => {
  const users = await Balance.find({})
  let list = []
  if (users) {
    list = await Promise.all(users.map(async user => {
      const tempUser = {
        address: '',
        hashrate: 0,
        miners: 0,
        lastShare: null,
        status: 'offline'
      }
      tempUser.address = user.address
      const dbMiner = await Miner.find({ address: user.address })
      if (dbMiner) {
        let tempMiners = await Promise.all(dbMiner.map(async miner => {
          const dbShare = await Hashrate.find({ createdAt: { $gt: new Date(Date.now() - (600 * 1000)) }, address: user.address, workerName: miner.workerName })
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
          tempMiners = tempMiners.reduce((miner, current) => {
            const x = miner.find(info => info.name === current.name)
            if (!x) {
              return miner.concat([current])
            } else {
              return miner
            }
          }, [])
          tempUser.miners = tempMiners.filter(miner => miner.status === 'online').length
          tempUser.hashrate = tempMiners.reduce((a, b) => a + (b.hashrate || 0), 0)
          tempUser.lastShare = (tempMiners.length > 0 ? tempMiners.sort((a, b) => moment(b.lastShare).unix() - moment(a.lastShare).unix())[0].lastShare : null)
          tempUser.status = (tempMiners.filter(miner => miner.status === 'online').length > 0 ? 'online' : 'offline')
        }
        return tempUser
      }
    }))
  }
  res.json(list).end()
}))

app.use((err, req, res, next) => {
  if (err) {
    logger('error', 'api', `Error: ${err}`)
    res.status(400).send({ error: err.message })
  }
})

const server = !config.api.ssl
  ? http.createServer(app)
  : https.createServer({
    cert: fs.readFileSync(__dirname + config.api.cert),
    key: fs.readFileSync(__dirname + config.api.key)
  }, app)

server.listen(config.api.port, () => {
  logger('info', 'api', `Started api server on port: ${config.api.port}`)
})
