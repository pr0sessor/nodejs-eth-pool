const moment = require('moment')
const config = require('../config')

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
    this.noRetarget = nicehash
  }

  updateActivity () {
    this.active = true
    this.lastActivity = moment().unix()
  }

  vardiff () {
    const variance = config.stratumServer.varDiff.variancePercent / 100 * config.blockTime
    return {
      variance: variance,
      bufferSize: config.stratumServer.varDiff.retargetTime / config.blockTime * 4,
      tMin: config.blockTime - variance,
      tMax: config.blockTime + variance,
      maxJump: config.stratumServer.varDiff.maxJump
    }
  }

  retarget (now) {
    const options = config.stratumServer.varDiff
    const VarDiff = this.vardiff()

    const sinceLast = now - this.lastActivity
    const decreaser = sinceLast > VarDiff.tMax

    const avg = this.shareTimeRing.avg(decreaser ? sinceLast : null)
    let newDiff

    let direction

    if (avg > VarDiff.tMax && this.difficulty > options.minDiff) {
      newDiff = options.targetTime / avg * this.difficulty
      newDiff = newDiff > options.minDiff ? newDiff : options.minDiff
      direction = -1
    } else if (avg < VarDiff.tMin && this.difficulty < options.maxDiff) {
      newDiff = options.targetTime / avg * this.difficulty
      newDiff = newDiff < options.maxDiff ? newDiff : options.maxDiff
      direction = 1
    } else {
      return
    }

    if (Math.abs(newDiff - this.difficulty) / this.difficulty * 100 > options.maxJump) {
      const change = options.maxJump / 100 * this.difficulty * direction
      newDiff = this.difficulty + change
    }
    this.difficulty = newDiff
  }
}

module.exports = Miner
