# nodejs-eth-pool

## What is it?

A multi-port stratum pool for ethereum.

## Prerequisites

* make
* build-essential

## Features

* Stratum
* Nicehash
* Solo mining
* Multi-port
* Can be used as proxy
* Variable difficulty

## How to setup and run?

```javascript
sudo apt update
sudo apt install make build-essential -y
git clone https://github.com/pr0sessor/nodejs-eth-pool
cd nodejs-eth-pool
npm install
node app <args>
```

## Arguments

* --api (enables API server)
* --stratum (enables Stratum server)
* --unlocker (enables Unlocker)
* --payout (enables Payout)
* --cron (enables Cron Jobs)

## Example

```javascript
node app --stratum --solo
```
Just like open-ethereum-pool, you can run the features separately as long as they're connected to the same MongoDB.
* 1x instance of Stratum per node (You can have multiple nodes)
* 1x instance of API 
* 1x instance of Unlocker, Payout and Cron Job per pool (You must only run 1 instance of Unlocker, Payout and Cron Job to avoid duplication)

## Requirements

* A fully synced node
* Node.js (10.x)
* MongoDB (4.x)

## Dependencies

* deasync
* memdown
* levelup
* web3
* node-ethash
* bignum
* request
* mongoose
* moment
* express
* body-parser
* cors
* colors
* socket.io
