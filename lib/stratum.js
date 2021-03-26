const moment = require('moment')
const net = require('net')
const levelup = require('levelup')
const memdown = require('memdown')
const async = require('async')
const Ethash = require('node-ethash')
const deasync = require('deasync')
const io = require('socket.io-client')

/**
 * Libraries
 **/
const logger = require('./logger')
const utils = require('./utils')
const Miner = require('./miner')
const Upstream = require('./upstream')

/**
 * Config
 **/
const config = require('../config.js')

/**
 * Socket IO
 */
const socket = io(`http://${config.socket.host}:${config.socket.port}`)

socket.on('connect_error', () => {
  logger('error', 'socket', 'Connection to socket.io server failed')
  process.exit()
})

/**
 * Ethash
 **/
let states = { generating: false }
const getEpoc = new Ethash().getEpoc
const cacheDB = levelup(memdown())
let currEpoch = 0
let nextEpoch = 0

const miners = []

function updateStates (blockNumber) {
  if (states.generating) return

  currEpoch = getEpoc(blockNumber)
  nextEpoch = currEpoch + 1

  if (!states[currEpoch]) {
    logger('info', 'system', `Calculating state for current epoch #${currEpoch}`)
    states.generating = true
    const ethash = new Ethash(cacheDB)
    ethash.loadEpoc(currEpoch * 30000, st => {
      states = states || {}
      states[currEpoch] = ethash
    })
    deasync.loopWhile(() => { return !states[currEpoch] })
    states.generating = false
    logger('info', 'system', `Calculation done, current seed is ${states[currEpoch].seed.toString('hex')}`)
  }

  if (!states[nextEpoch]) {
    logger('info', 'system', `Pre-calculating next state for epoch #${nextEpoch}`)
    const ethash = new Ethash(cacheDB)
    ethash.loadEpoc(nextEpoch * 30000, st => {
      if (!st || states[nextEpoch]) return
      states = states || {}
      states[nextEpoch] = ethash
      logger('info', 'system', `Pre-calculation done, next seed is ${states[nextEpoch].seed.toString('hex')}`)
    })
  }
}
/**
 * Upstream
 */
const upstream = new Upstream()
upstream.refreshWork(updateStates)

/* let blockNumber = null
upstream.getBlockNumber(res => {
  blockNumber = res
})
deasync.loopWhile(() => { return !blockNumber })
updateStates(blockNumber) */

async.forEach(config.stratumServer.ports, (portData) => {
  StratumServer(portData)
})

/**
 * Periodical updaters
 **/

// Variable difficulty retarget
setInterval(function () {
  const now = moment().unix()
  for (const i in miners) {
    if (!miners[i].noRetarget) miners[i].retarget(now)
  }
}, config.stratumServer.varDiff.retargetTime * 1000)

// Every 30 seconds clear out timed-out miners
setInterval(function () {
  const now = moment().unix()
  const timeout = config.stratumServer.minerTimeout * 1000
  for (const miner in miners) {
    if (now - miner.lastActivity > timeout) {
      logger('warn', 'stratum', `Miner timed out and disconnected ${miner.address}@${miner.ip}`)
      removeConnectedWorker(miner)
      delete miners[miner.extraNonce]
    }
  }
}, 30000)

setInterval(() => {
  upstream.refreshWork(updateStates)
}, config.stratumServer.blockRefreshInterval)

function handleMinerData (method, params, socket, portData, difficulty, sendReply, sendReplyNH, pushMessage, makeJob, makeJobNH) {
  if (!method || !params) {
    sendReply('Malformed stratum request')
  }

  const methods = {}

  methods.eth_submitLogin = () => {
    const [login, pass] = params
    if (!login) return sendReply('Missing login')

    const solo = pass.includes('solo')
    if (!portData.solo && solo) return sendReply('Solo mining is not allowed on this port')

    let [address, workerName] = login.split('.')
    if (!utils.validateAddress(address)) return sendReply('Invalid address')
    if (!workerName) workerName = 0

    const miner = new Miner(utils.generateUnid(), socket, address, pass, solo, false, workerName, socket.remoteAddress, portData.port, difficulty, pushMessage)
    miners[socket.extraNonce] = miner
    sendReply(null, true)

    newConnectedWorker(miner)
    logger('info', 'stratum', `${(miner.solo ? 'Solo miner' : 'Miner')} connected ${miner.address}@${miner.ip} on port ${miner.port} `)
  }

  methods.eth_getWork = () => {
    let job = null
    deasync.loopWhile(() => {
      job = makeJob(socket.extraNonce)
      return !job
    })
    sendReply(null, job)
  }

  methods.eth_submitHashrate = () => sendReply(null, true)
  methods.eth_submitWork = () => upstream.processShare(params, miners[socket.extraNonce], states[currEpoch], sendReply)

  methods['mining.subscribe'] = () => {
    if (params[1] !== 'EthereumStratum/1.0.0') return sendReplyNH('Unsupported protocol version')
    if (!portData.nicehash) return sendReplyNH('Nicehash is not allowed on this port')

    const subscriptionHash = utils.generateUnid()
    const extraNonce = socket.extraNonce

    sendReplyNH(null, [
      [
        'mining.notify',
        subscriptionHash,
        'EthereumStratum/1.0.0'
      ],
      extraNonce
    ])
  }
  methods['mining.authorize'] = () => {
    const [login, pass] = params
    if (!login) return sendReplyNH('Missing login')

    const solo = pass.includes('solo')
    if (!portData.solo && solo) return sendReplyNH('Solo mining is not allowed on this port')

    let [address, workerName] = login.split('.')
    if (!utils.validateAddress(address)) return sendReplyNH('Invalid address')
    if (!workerName) workerName = 0

    const miner = new Miner(utils.generateUnid(), socket, address, pass, solo, true, workerName, socket.remoteAddress, portData.port, difficulty, pushMessage)
    miners[socket.extraNonce] = miner
    sendReplyNH(null, true)
    newConnectedWorker(miner)

    pushMessage('mining.set_difficulty', [miner.difficulty])
    pushMessage('mining.notify', makeJobNH(socket.extraNonce))
    logger('info', 'stratum', `Nicehash ${(miner.solo ? 'Solo miner' : 'Miner')} connected ${miner.address}@${miner.ip} on port ${miner.port} `)
  }
  methods['mining.submit'] = () => upstream.processNHShare(params, miners[socket.extraNonce], states[currEpoch], sendReply)
  methods['mining.extranonce.subscribe'] = () => {
    socket.write(JSON.stringify({
      id: null,
      method: 'mining.set_extranonce',
      params: [
        socket.extraNonce
      ]
    }) + '\n')
  }

  if (!Object.keys(methods).includes(method)) {
    return sendReply('Unknown stratum method')
  }
  methods[method]()
}

/**
 * New connected worker
 **/
function newConnectedWorker (miner) {
  if (miner.workerName !== 'undefined') logger('info', 'stratum', `Worker Name: ${miner.workerName}`)
  if (miner.difficulty) logger('info', 'stratum', `Miner difficulty fixed to ${(miner.nicehash ? miner.difficulty * config.coinDifficulty * 4 : miner.difficulty * config.coinDifficulty)}`)
  socket.emit('miner_connect', {
    uniqueId: miner.uniqueId,
    address: miner.address,
    workerName: miner.workerName,
    ip: miner.ip,
    port: miner.port,
    status: 'online'
  })
}

/**
 * New connected worker
 **/
function removeConnectedWorker (miner) {
  socket.emit('miner_disconnect', miner)
}

/**
 * Stratum Server
 */
const httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 20\n\nMining server online'

function StratumServer (portData) {
  const makeJob = function (extraNonce) {
    const topJob = upstream.getTopJob()
    const miner = miners[extraNonce]
    if (!topJob || !miner) {
      return false
    }

    return [
      topJob.powHash,
      topJob.seedHash,
      utils.diffToTarget(miner.difficulty * config.coinDifficulty)
    ]
  }

  const makeJobNH = function (extraNonce) {
    const topJob = upstream.getTopJob()
    if (topJob === null) {
      return false
    }

    return [
      extraNonce + topJob.jobId,
      topJob.seedHash.substr(2),
      topJob.powHash.substr(2),
      true
    ]
  }

  const broadcastJob = function () {
    const conns = Object.values(miners)
    for (let i = 0; i < conns.length; ++i) {
      const miner = conns[i]
      if (!miner) return
      if (miner.nicehash) {
        const jobData = makeJobNH(miner.extraNonce)
        if (!miner.socket.writable || !jobData) return
        const sendData = JSON.stringify({
          id: null,
          method: 'mining.notify',
          params: jobData
        }) + '\n'
        miner.socket.write(sendData)
      } else {
        const jobData = makeJob(miner.extraNonce)
        if (!jobData) return
        const job = JSON.stringify({
          id: 0,
          jsonrpc: '2.0',
          result: jobData
        }) + '\n'
        if (!miner.socket.writable || !job) return
        miner.socket.write(job)
      }
    }
  }

  const handleMessage = function (socket, jsonData, pushMessage) {
    if (!jsonData.id) {
      return logger('error', 'stratum', `Malformed stratum request from ${socket.remoteAddress}`)
    }

    const sendReply = function (error, result) {
      if (!socket.writable) return
      const sendData = JSON.stringify({
        id: jsonData.id,
        error: error ? { code: -1, message: error } : null,
        result: !error ? result : null
      }) + '\n'
      socket.write(sendData)
    }

    const sendReplyNH = function (error, result) {
      if (!socket.writable) return
      const sendData = JSON.stringify({
        id: jsonData.id,
        error: error ? { code: -1, message: error } : null,
        result: !error ? result : null
      }) + '\n'
      socket.write(sendData)
    }
    handleMinerData(jsonData.method, jsonData.params, socket, portData, portData.difficulty, sendReply, sendReplyNH, pushMessage, makeJob, makeJobNH)
  }

  function socketConn (socket) {
    let dataBuffer = ''

    socket.extraNonce = utils.makeNonce(config.nonceSize)

    socket.setKeepAlive(true)
    socket.setEncoding('utf8')

    let pushMessage = function (method, params) {
      if (!socket.writable) {
        return
      }
      const sendData = JSON.stringify({
        id: null,
        method: method,
        params: params
      }) + '\n'
      socket.write(sendData)
    }

    socket.on('data', function (d) {
      dataBuffer += d
      if (Buffer.byteLength(dataBuffer, 'utf8') > 10240) { // 10KB
        dataBuffer = null
        logger('warn', 'socket', `Excessive packet size from: ${socket.remoteAddress}`)
        socket.destroy()
        return
      }
      if (dataBuffer.indexOf('\n') !== -1) {
        const messages = dataBuffer.split('\n')
        const incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop()
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i]
          if (message.trim() === '') {
            continue
          }
          let jsonData
          try {
            jsonData = JSON.parse(message)
          } catch (e) {
            if (message.indexOf('GET /') === 0 || message.indexOf('POST /') === 0) {
              if (message.indexOf('HTTP/1.1') !== -1) {
                socket.end('HTTP/1.1' + httpResponse)
                break
              } else if (message.indexOf('HTTP/1.0') !== -1) {
                socket.end('HTTP/1.0' + httpResponse)
                break
              }
            }
            logger('error', 'socket', `Malformed message from ${socket.remoteAddress} Message: ${message}`)
            socket.destroy()
            break
          }
          handleMessage(socket, jsonData, pushMessage)
        }
        dataBuffer = incomplete
      }
    }).on('error', err => {
      if (err.code !== 'ECONNRESET') {
        logger('error', 'socket', `Socket Error from ${socket.remoteAddress} Error: ${err}`)
      }
    }).on('close', async () => {
      pushMessage = function () {}
      logger('error', 'stratum', `Miner disconnected ${socket.remoteAddress}`)
      const miner = miners[socket.extraNonce]
      if (miner) {
        removeConnectedWorker(miner)
        delete miners[miner.extraNonce]
      }
    })
  }

  const server = net.createServer(socketConn)
  upstream.setFunction(broadcastJob)
  server.listen(portData.port, error => {
    if (error) {
      logger('error', 'stratum', `Unable to start stratum server on: ${portData.port} Message: ${error}`)
      return
    }
    logger('info', 'stratum', `Started stratum server on port: ${portData.port}`)
  })
}
