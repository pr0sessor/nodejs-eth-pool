const mongoose = require('mongoose')
const BigNumberSchema = require('mongoose-bignumber')
const { toJSON, paginate } = require('./plugins')

const Schema = mongoose.Schema(
  {
    address: {
      type: String,
      trim: true,
      lowercase: true
    },
    workerName: {
      type: String,
      trim: true
    },
    difficulty: {
      type: BigNumberSchema
    }
  },
  {
    timestamps: true
  }
)

// add plugin that converts mongoose to json
Schema.plugin(toJSON)
Schema.plugin(paginate)

const Hashrate = mongoose.model('Hashrate', Schema)

module.exports = Hashrate
