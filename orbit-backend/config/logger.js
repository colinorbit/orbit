'use strict';
const { createLogger, format, transports } = require('winston');

module.exports = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    format.errors({ stack: true }),
    format.colorize(),
    format.printf(({ timestamp, level, message, stack }) =>
      stack ? `${timestamp} ${level}: ${message}\n${stack}` : `${timestamp} ${level}: ${message}`)
  ),
  transports: [new transports.Console()],
});
