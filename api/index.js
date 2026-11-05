'use strict';

const { createStudySyncHandler } = require('../server');

const handler = createStudySyncHandler();

module.exports = (req, res) => {
  return handler(req, res);
};
