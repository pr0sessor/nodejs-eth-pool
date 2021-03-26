
const request = require('request-promise-native')

const config = require('../config')

/**
 * Send API request using JSON HTTP
 **/
const jsonHttpRequest = (data, callback) => {
  try {
    callback = callback || function () {}
    const options = {
      uri: `http://${config.upstream}`,
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Length': data.length,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    }
    options.json = data

    request(options)
      .then(response => {
        response = response || {}
        if (response instanceof Array || response instanceof Object) {
          callback(null, response)
        } else {
          callback(null, JSON.parse(response))
        }
      })
      .catch(error => {
        callback(error, {})
      })
  } catch (error) {
    console.log('catch ', error)
    callback(error, {})
  }
}

const rpc = (method, params, callback) => {
  const payload = {
    id: '0',
    jsonrpc: '2.0',
    method: method,
    params: params
  }
  // let data = JSON.stringify(payload);
  jsonHttpRequest(payload, function (error, replyJson) {
    if (error) {
      callback(error, {})
      return
    }
    callback(replyJson.error, replyJson.result)
  })
}

module.exports = rpc
