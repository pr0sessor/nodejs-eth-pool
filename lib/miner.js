const moment = require('moment')

class Miner {
  constructor (uniqueId, socket, address, pass, solo, nicehash, workerName, ip, port, difficulty, pushMessage) {
    this.uniqueId = uniqueId
    this.minerId = `${ip}:${port}`
    this.socket = socket
    this.extraNonce = socket.extraNonce
    this.address = address
    this.pass = pass
    this.solo = (!!solo)
    this.nicehash = nicehash
    this.workerName = workerName
    this.ip = ip
    this.port = port
    this.pushMessage = pushMessage
    this.difficulty = difficulty
    this.active = true
    this.lastActivity = 0
  }

  updateActivity () {
    this.active = true
    this.lastActivity = moment().unix()
  }
}

module.exports = Miner
