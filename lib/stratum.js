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

async.forEach(config.stratumServer.ports, (portData) => {
  StratumServer(portData)
})

/**
 * Periodical updaters
 **/

// Variable difficulty retarget
setInterval(function () {
  for (const i in miners) {
    if (!miners[i].noRetarget) miners[i].retarget()
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

/**
 * Socket handler
 */

function handleMinerData (method, params, socket, portData, difficulty, sendReplyEP, sendReplyES, pushMessage, makeJobEP, makeJobES) {
  if (!method || !params) {
    sendReplyEP('Malformed stratum request')
  }

  const methods = {}

  methods.eth_submitLogin = () => {
    console.log(params)
    let [login, pass, workerName] = params
    if (!login) return sendReplyEP('Missing login')

    let solo = false
    if (pass) {
      solo = pass.includes('solo')
      if (!portData.solo && solo) return sendReplyEP('Solo mining is not allowed on this port')
    }

    if (login.includes('.')) {
      workerName = login.split('.')[1] || workerName
      login = login.split('.')[0]
    }
    if (!utils.validateAddress(login)) return sendReplyEP('Invalid address')
    if (!workerName) workerName = 0

    const miner = new Miner(utils.generateUnid(), socket, login, pass, solo, 'proxy', workerName, socket.remoteAddress, portData, difficulty, pushMessage)
    miners[socket.extraNonce] = miner
    sendReplyEP(null, true)

    newConnectedWorker(miner)
    logger('info', 'stratum', `Proxy ${(miner.solo ? 'Solo miner' : 'Miner')} connected ${miner.address}@${miner.ip} on port ${miner.port} `)
  }

  methods.eth_getWork = () => {
    let job = null
    while (!job) {
      job = makeJobEP(socket.extraNonce)
    }
    sendReplyEP(null, job)
  }

  methods.eth_submitHashrate = () => sendReplyEP(null, true)
  methods.eth_submitWork = () => upstream.processEPShare(params, miners[socket.extraNonce], states[currEpoch], sendReplyEP)

  methods['mining.subscribe'] = () => {
    if (params[1] !== 'EthereumStratum/1.0.0') return sendReplyES('Unsupported protocol version')
    if (!portData.nicehash) return sendReplyES('Nicehash is not allowed on this port')

    const subscriptionHash = utils.generateUnid()
    const extraNonce = socket.extraNonce

    sendReplyES(null, [
      [
        'mining.notify',
        subscriptionHash,
        'EthereumStratum/1.0.0'
      ],
      extraNonce
    ])
  }
  methods['mining.authorize'] = () => {
    let [login, pass, workerName] = params
    if (!login) return sendReplyES('Missing login')

    let solo = false
    if (pass) {
      solo = pass.includes('solo')
      if (!portData.solo && solo) return sendReplyEP('Solo mining is not allowed on this port')
    }

    if (login.includes('.')) {
      workerName = login.split('.')[1] || workerName
      login = login.split('.')[0]
    }
    if (!utils.validateAddress(login)) return sendReplyES('Invalid address')
    if (!workerName) workerName = 0

    const miner = new Miner(utils.generateUnid(), socket, login, pass, solo, 'stratum', workerName, socket.remoteAddress, portData, difficulty, pushMessage)
    miners[socket.extraNonce] = miner
    sendReplyES(null, true)
    newConnectedWorker(miner)
    pushMessage('mining.set_difficulty', [miner.difficulty / 2])
    pushMessage('mining.notify', makeJobES(socket.extraNonce))
    logger('info', 'stratum', `Stratum ${(miner.solo ? 'Solo miner' : 'Miner')} connected ${miner.address}@${miner.ip} on port ${miner.port} `)
  }
  methods['mining.submit'] = () => upstream.processESShare(params, miners[socket.extraNonce], states[currEpoch], sendReplyEP)
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
    return sendReplyEP('Unknown stratum method')
  }
  methods[method]()
}

/**
 * New connected worker
 **/
function newConnectedWorker (miner) {
  if (miner.workerName !== 'undefined') logger('info', 'stratum', `Worker Name: ${miner.workerName}`)
  if (miner.difficulty) logger('info', 'stratum', `Miner difficulty fixed to ${miner.difficulty}`)
  socket.emit('miner_connect', {
    uniqueId: miner.uniqueId,
    address: miner.address,
    workerName: miner.workerName,
    ip: miner.ip,
    port: miner.port,
    status: 'online'
  }, config.socket.key)
}

/**
 * New connected worker
 **/
function removeConnectedWorker (miner) {
  socket.emit('miner_disconnect', miner, config.socket.key)
}

/**
 * Stratum Server
 */
const httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 20\n\nMining server online'

function StratumServer (portData) {
  const makeJobEP = function (extraNonce) {
    const topJob = upstream.getTopJob()
    const miner = miners[extraNonce]
    if (!topJob || !miner) {
      return false
    }

    return [
      topJob.powHash,
      topJob.seedHash,
      utils.diffToTarget(miner.difficulty * config.diffToShare)
    ]
  }

  const makeJobES = function (extraNonce) {
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
      if (miner.type === 'stratum') {
        const jobData = makeJobES(miner.extraNonce)
        if (!miner.socket.writable || !jobData) return
        const sendData = JSON.stringify({
          id: null,
          method: 'mining.notify',
          params: jobData
        }) + '\n'
        miner.socket.write(sendData)
      } else {
        const jobData = makeJobEP(miner.extraNonce)
        if (!jobData) return
        const job = JSON.stringify({
          id: 0,
          jsonrpc: '2.0',
          result: jobData
        }) + '\n'
        if (!miner.socket.writable || !job) return
        // miner.clearMiningTime()
        miner.socket.write(job)
      }
    }
  }

  const handleMessage = function (socket, jsonData, pushMessage) {
    if (!jsonData.id) {
      return logger('error', 'stratum', `Malformed stratum request from ${socket.remoteAddress}`)
    }

    const sendReplyEP = function (error, result) {
      if (!socket.writable) return
      const sendData = JSON.stringify({
        id: jsonData.id,
        error: error ? { code: -1, message: error } : null,
        result: !error ? result : null
      }) + '\n'
      socket.write(sendData)
    }

    const sendReplyES = function (error, result) {
      if (!socket.writable) return
      const sendData = JSON.stringify({
        id: jsonData.id,
        error: error ? { code: -1, message: error } : null,
        result: !error ? result : null
      }) + '\n'
      socket.write(sendData)
    }
    handleMinerData(jsonData.method, jsonData.params, socket, portData, portData.difficulty, sendReplyEP, sendReplyES, pushMessage, makeJobEP, makeJobES)
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
