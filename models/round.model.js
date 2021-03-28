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
    },
    solo: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
)

// add plugin that converts mongoose to json
Schema.plugin(toJSON)
Schema.plugin(paginate)

const Round = mongoose.model('Round', Schema)

module.exports = Round
