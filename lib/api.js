const bodyParser = require('body-parser')
const express = require('express')
const fs = require('fs')
const http = require('http')
const https = require('https')
const cors = require('cors')
const SocketIO = require('socket.io')

const catchAsync = require('./catchAsync')
const logger = require('./logger')
const api = require('./apiFunctions')

const config = require('../config')

// API server
const app = express()
app.use(bodyParser.json())
app.use(cors())

// GET
app.get('/api/stats', catchAsync(async (req, res) => {
  api.getStats((stats) => {
    res.json(stats).end()
  })
}))

app.get('/api/accounts/:address', catchAsync(async (req, res) => {
  api.getMinerStats(req.params.address, (err, stats) => {
    if (err) return res.status(404).json({ error: err.message }).end()
    res.json(stats).end()
  })
}))

app.get('/api/blocks', catchAsync(async (req, res) => {
  api.getPoolBlocks((blocks) => {
    res.json(blocks).end()
  })
}))

app.get('/api/payments', catchAsync(async (req, res) => {
  api.getPoolPayments((payments) => {
    res.json(payments.map(payment => {
      return {
        address: payment.address,
        amount: payment.amount,
        hash: payment.hash,
        datePaid: payment.datePaid
      }
    })).end()
  })
}))

app.get('/api/miners', catchAsync(async (req, res) => {
  api.getPoolMiners((miners) => {
    res.json(miners).end()
  })
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

// Socket API
const io = SocketIO(server)
io.on('connection', (socket) => {
  socket.on('stats', () => {
    api.getStats((stats) => {
      socket.emit('stats', stats)
    })
  })
  socket.on('account', (address) => {
    api.getMinerStats(address, (err, stats) => {
      if (err) return socket.emit('account', err)
      socket.emit('account', stats)
    })
  })
  socket.on('blocks', () => {
    api.getPoolBlocks((blocks) => {
      socket.emit('blocks', blocks)
    })
  })
  socket.on('payments', () => {
    api.getPoolPayments((payments) => {
      socket.emit('payments', payments.map(payment => {
        return {
          address: payment.address,
          amount: payment.amount,
          hash: payment.hash,
          datePaid: payment.datePaid
        }
      }))
    })
  })
  socket.on('miners', () => {
    api.getPoolMiners((miners) => {
      socket.emit('miners', miners)
    })
  })
})

server.listen(config.api.port, () => {
  logger('info', 'api', `Started api server on port: ${config.api.port}`)
})
