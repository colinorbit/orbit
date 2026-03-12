'use strict';
const { Sequelize, DataTypes } = require('sequelize');
const logger = require('./logger');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: (msg) => logger.debug(msg),
  pool: { max: 10, min: 2, acquire: 30000, idle: 10000 },
  dialectOptions: { ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false },
});

async function connectDB() {
  await sequelize.authenticate();
  if (process.env.NODE_ENV !== 'production') await sequelize.sync({ alter: true });
  logger.info('✅  PostgreSQL connected');
}

module.exports = { sequelize, connectDB, DataTypes, Sequelize };
