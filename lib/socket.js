const moment = require('moment')
const http = require('http').createServer()
const io = require('socket.io')(http)

const logger = require('./logger')

const config = require('../config')

const { Miner, Round, Hashrate, Candidate, Balance } = require('../models')

io.on('connection', (socket) => {
  socket.on('miner_connect', (data) => {
    Miner.findOne({ address: data.address, workerName: data.workerName }, (err, res) => {
      if (err) return logger('error', 'mongo', err.message)
      if (!res) {
        Miner.create(data)
        Balance.findOne({ address: data.address }, (err2, res2) => {
          if (err2) return logger('error', 'mongo', err2.message)
          if (!res2) {
            Balance.create({ address: data.address }).catch(err => logger('warn', 'stratum', err.message))
          }
        })
      }
    })
  })
  socket.on('miner_disconnect', (data) => {
    Miner.findOne({ uniqueId: data.uniqueId }, (err, res) => {
      if (err) return logger('error', 'mongo', err.message)
      if (res) {
        Object.assign(res, {
          status: 'offline'
        }).save()
      }
    })
  })
  socket.on('share', (data) => {
    Round.create(data)
    Hashrate.create(data)
    Miner.findOne({ address: data.address, workerName: data.workerName }, (err, miner) => {
      if (err) return logger('err', 'mongo', err.message)
      Object.assign(miner, {
        lastShare: moment().unix(),
        shares: Number(miner.shares) + Number(data.difficulty)
      }).save()
    })
  })
  socket.on('candidate', (data) => {
    Round.find({}, (err, res) => {
      if (err) return logger('error', 'mongo', err.message)
      const tmpRound = []
      res.forEach((share) => {
        if (!tmpRound[share.address]) {
          tmpRound[share.address] = Number(share.difficulty)
        } else {
          tmpRound[share.address] += Number(share.difficulty)
        }
        share.remove()
      })
      const round = []
      let totalShares = 0
      Object.keys(tmpRound).forEach((address) => {
        totalShares += tmpRound[address]
        round.push({ address, difficulty: tmpRound[address] })
      })
      Object.assign(data, {
        round,
        totalShares
      })
      Candidate.create(data)
    })
  })
  socket.on('immature_update', data => {
    const { address, immature } = data
    Balance.findOne({ address }, (err, balance) => {
      if (err) return logger('error', 'mongo', err.message)
      Object.assign(balance, {
        immature: Number(balance.immature) + immature
      }).save()
    })
  })
  socket.on('unlock_update', data => {
    const { address, amount } = data
    Balance.findOne({ address }, (err, balance) => {
      if (err) return logger('error', 'mongo', err.message)
      Object.assign(balance, {
        immature: Number(balance.immature) - amount,
        pending: Number(balance.pending) + amount
      }).save()
    })
  })
  socket.on('fee_update', data => {
    const { amount } = data
    Balance.findOne({ address: config.unlocker.address }, (err, balance) => {
      if (err) return logger('error', 'mongo', err.message)
      Object.assign(balance, {
        pending: Number(balance.pending) + amount
      }).save()
    })
  })
})

http.listen(config.socket.port, () => {
  logger('info', 'socket', `Socket.io listening to port ${config.socket.port}`)
})
