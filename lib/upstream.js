const io = require('socket.io-client')

const logger = require('./logger')
const utils = require('./utils')
const rpc = require('./rpc')

const config = require('../config')
const socket = io(`http://${config.socket.host}:${config.socket.port}`)

socket.on('connect_error', () => {
  logger('error', 'socket', 'Connection to socket.io server failed')
  process.exit()
})

class Upstream {
  constructor () {
    this.jobs = []
    this.broadcastJob = null
  }

  setJob (work) {
    const blockHeight = Number(work[3])
    const jobId = work[0].substr(work[0].length - 16)
    if (this.jobs.findIndex(job => job.jobId === jobId) !== -1) return
    /* if (this.jobs.findIndex(job => job.blockHeight > blockHeight) !== -1) return
    if (this.jobs.findIndex(job => job.blockHeight === blockHeight) !== -1) return */
    this.jobs = this.jobs.filter(job => job.blockHeight > (blockHeight - config.stratumServer.maxBackLog))
    this.jobs.push({ jobId: jobId, powHash: work[0], seedHash: work[1], blockTarget: work[2], blockHeight: blockHeight })
    logger('info', 'upstream', `New block to mine at height ${blockHeight}. Job #${jobId}`)
    if (this.broadcastJob) this.broadcastJob()
  }

  getBlockNumber (cb) {
    rpc('eth_getBlockByNumber', ['latest', false], (err, res) => {
      if (err) return logger('error', 'upstream', 'Failed to get latest block number')
      cb(res.number)
    })
  }

  refreshWork (updateStates) {
    this.getWork(work => {
      updateStates(Number(work[3]))
    })
  }

  getWork (cb) {
    rpc('eth_getWork', [], (err, work) => {
      if (err) return logger('error', 'upstream', 'Failed to get work')
      this.setJob(work)
      cb(work)
    })
  }

  getTopJob () {
    return this.jobs[this.jobs.length - 1]
  }

  setFunction (func) {
    this.broadcastJob = func
  }

  submitWork (nonce, powHash, mixHash, height, miner) {
    rpc('eth_submitWork', [nonce, powHash, mixHash], (err, result) => {
      if (err) return logger('error', 'upstream', 'Failed to submit work')
      if (result) {
        socket.emit('candidate', {
          address: miner.address,
          number: height,
          nonce,
          solo: miner.solo
        }, config.socket.key)
        logger('warn', 'stratum', `Candidate block #${height} was mined by ${miner.address}@${miner.ip}`)
      } else {
        logger('success', 'stratum', `Valid share received from ${miner.address}@${miner.ip}`)
      }
    })
  }

  findJob (jobId) {
    const index = this.jobs.findIndex(job => job.jobId === jobId)
    if (index !== -1) {
      return this.jobs[index]
    }
    return false
  }

  processShare (params, miner, ethash, sendReply) {
    if (!params || params.length !== 3) return sendReply('Malformed PoW result', null)
    if (!miner) return sendReply('Not subscribed', null)
    if (!ethash) return sendReply('Validator is not yet ready', null)
    const job = this.getTopJob()
    if (job.powHash !== params[1]) return sendReply('Stale share', null)

    const r = ethash.doHash(Buffer.from(utils.rmPreHex(params[1]), 'hex'), Buffer.from(utils.rmPreHex(params[0]), 'hex'))
    r.mix_hash = utils.preHex(r.mix_hash.toString('hex'))
    miner.active = true
    miner.updateActivity()

    socket.emit('share', {
      address: miner.address,
      workerName: miner.workerName,
      difficulty: miner.difficulty,
      solo: miner.solo
    }, config.socket.key)
    this.submitWork(params[0], utils.preHex(job.powHash), r.mix_hash, job.blockHeight, miner)
    sendReply(null, true)
  }

  processNHShare (params, miner, ethash, sendReply) {
    if (!params || params.length !== 3) return sendReply('Malformed PoW result', null)
    if (!miner) return sendReply('Not subscribed', null)
    if (!ethash) return sendReply('Validator is not yet ready', null)
    if (params[1].length !== config.nonceSize + 16) return sendReply('Invalid job id', null)
    const jobId = params[1].substr(config.nonceSize)
    const extraNonce = params[1].substr(0, config.nonceSize)

    const job = this.findJob(jobId)
    if (!job) return sendReply('Job not found', null)

    const r = ethash.doHash(Buffer.from(utils.rmPreHex(job.powHash), 'hex'), Buffer.from(extraNonce + params[2], 'hex'))
    r.mix_hash = utils.preHex(r.mix_hash.toString('hex'))
    miner.active = true
    miner.updateActivity()
    socket.emit('share', {
      address: miner.address,
      workerName: miner.workerName,
      difficulty: utils.targetToDiff(r.result.toString('hex')),
      solo: miner.solo
    }, config.socket.key)
    this.submitWork(utils.preHex(extraNonce + params[2]), utils.preHex(job.powHash), r.mix_hash, job.blockHeight, miner)
    sendReply(null, true)
  }
}

module.exports = Upstream
