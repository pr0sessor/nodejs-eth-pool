const moment = require('moment')
const http = require('http').createServer()
const io = require('socket.io')(http)

const logger = require('./logger')

const config = require('../config')

const { Miner, Round, Hashrate, Candidate, Reward } = require('../models')

io.on('connection', (socket) => {
  socket.on('miner_connect', (data, key) => {
    if (key !== config.socket.key) return
    Miner.findOne({ address: data.address, workerName: data.workerName }, (err, res) => {
      if (err) return logger('error', 'mongo', err.message)
      if (!res) {
        Miner.create(data)
      } else {
        Object.assign(res, {
          status: 'online'
        }).save()
      }
    })
  })
  socket.on('miner_disconnect', (data, key) => {
    if (key !== config.socket.key) return
    Miner.findOne({ uniqueId: data.uniqueId }, (err, res) => {
      if (err) return logger('error', 'mongo', err.message)
      if (res) {
        Object.assign(res, {
          status: 'offline'
        }).save()
      }
    })
  })
  socket.on('share', (data, key) => {
    if (key !== config.socket.key) return
    Round.create(data)
    Hashrate.create(data)
    Miner.findOne({ address: data.address, workerName: data.workerName }, (err, miner) => {
      if (err) return logger('err', 'mongo', err.message)
      Object.assign(miner, {
        status: 'online',
        lastShare: moment().unix(),
        shares: Number(miner.shares) + Number(data.difficulty)
      }).save()
    })
  })
  socket.on('candidate', (data, key) => {
    if (key !== config.socket.key) return
    Round.find({ solo: data.solo, createdAt: { $gt: new Date(Date.now() - (config.unlocker.hashrateDuration * 1000)) } }, (err, res) => {
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
  socket.on('immature_update', (data, key) => {
    if (key !== config.socket.key) return
    const { address, amount, number } = data
    Reward.create({
      address,
      amount,
      number
    })
  })
})

http.listen(config.socket.port, config.socket.host, () => {
  logger('info', 'socket', `Stratum socket listening to port ${config.socket.port}`)
})
