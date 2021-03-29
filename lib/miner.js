const moment = require('moment')

const config = require('../config')
const logger = require('./logger')

class Miner {
  constructor (uniqueId, socket, address, pass, solo, type, workerName, ip, portData, difficulty, pushMessage) {
    this.uniqueId = uniqueId
    this.minerId = `${ip}:${portData.port}`
    this.socket = socket
    this.extraNonce = socket.extraNonce
    this.address = address
    this.pass = pass
    this.solo = (!!solo)
    this.type = type
    this.workerName = workerName
    this.ip = ip
    this.port = portData.port
    this.pushMessage = pushMessage
    this.difficulty = difficulty
    this.active = true
    this.lastActivity = 0
    this.noRetarget = !portData.varDiff
    this.miningTime = []
  }

  updateActivity () {
    this.active = true
    this.miningTime.push(this.now() - this.lastActivity)
    this.lastActivity = moment().unix()
  }

  now () {
    return moment().unix()
  }

  clearMiningTime () {
    this.miningTime = []
  }

  avgMiningTime () {
    let totalTime = 0
    this.miningTime.forEach(time => { totalTime += time })
    return totalTime / 16
  }

  vardiff () {
    const varDiff = config.stratumServer.varDiff
    const variance = varDiff.variancePercent / 100 * varDiff.targetTime
    return {
      variance: variance,
      tMin: varDiff.targetTime - variance,
      tMax: varDiff.targetTime + variance,
      maxJump: varDiff.maxJump
    }
  }

  retarget () {
    const options = config.stratumServer.varDiff
    const currentDiff = this.difficulty
    const varDiff = this.vardiff()
    const avg = this.avgMiningTime()
    let newDiff
    let direction

    if (avg > varDiff.tMax && currentDiff > options.minDiff) {
      newDiff = options.targetTime / avg * currentDiff
      newDiff = newDiff > options.minDiff ? newDiff : options.minDiff
      direction = -1
    } else if (avg < varDiff.tMin && currentDiff < options.maxDiff) {
      newDiff = options.targetTime / avg * currentDiff
      newDiff = newDiff < options.maxDiff ? newDiff : options.maxDiff
      direction = 1
    } else {
      return
    }

    if (Math.abs(newDiff - currentDiff) / currentDiff * 100 > options.maxJump) {
      const change = options.maxJump / 100 * currentDiff * direction
      newDiff = currentDiff + change
    }
    if (this.difficulty === newDiff) return
    logger('main', 'stratum', `Retargetting difficulty ${this.difficulty} to ${newDiff} for ${this.address}@${this.ip}`)
    this.difficulty = newDiff
    this.clearMiningTime()
  }
}

module.exports = Miner
