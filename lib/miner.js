const moment = require('moment')

const utils = require('./utils')

const config = require('../config')

class Miner {
  constructor (uniqueId, socket, address, pass, solo, nicehash, workerName, ip, portData, difficulty, pushMessage) {
    this.uniqueId = uniqueId
    this.minerId = `${ip}:${portData.port}`
    this.socket = socket
    this.extraNonce = socket.extraNonce
    this.address = address
    this.pass = pass
    this.solo = (!!solo)
    this.nicehash = nicehash
    this.workerName = workerName
    this.ip = ip
    this.port = portData.port
    this.pushMessage = pushMessage
    this.difficulty = difficulty
    this.active = true
    this.lastActivity = 0
    this.noRetarget = !portData.varDiff
    this.shareTimeRing = utils.ringBuffer(16)
  }

  updateActivity () {
    this.active = true
    this.shareTimeRing.append(this.now() - this.lastActivity)
    this.lastActivity = moment().unix()
  }

  now () {
    return moment().unix()
  }

  vardiff () {
    const varDiff = config.stratumServer.varDiff
    const variance = varDiff.variancePercent / 100 * config.blockTime
    return {
      variance: variance,
      bufferSize: varDiff.retargetTime / config.blockTime * 4,
      tMin: config.blockTime - variance,
      tMax: config.blockTime + variance,
      maxJump: varDiff.maxJump
    }
  }

  retarget () {
    const options = config.stratumServer.varDiff
    const VarDiff = this.vardiff()
    options.minDiff = options.minDiff * config.coinDifficulty
    options.maxDiff = options.maxDiff * config.coinDifficulty

    const sinceLast = this.now() - this.lastActivity
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
    this.difficulty = Number((newDiff / config.coinDifficulty).toFixed(2))
    this.shareTimeRing.clear()
  }
}

module.exports = Miner
