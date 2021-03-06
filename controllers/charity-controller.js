var mongoose = require('mongoose');
var aqp = require('api-query-params');
var Charity = require('../models/charity')(mongoose);
const { filterObject } = require('../lib/utils');
const { isDescendantOfAny } = require('../lib/query-helpers');

const LATEST_VERSION = 'v0.2.0';
const COMPULSORY_FIELDS = ['charityNumber', 'subNumber', 'registered', 'name'];
const PRIVATE_FIELDS = [];

const isPublic = (requestedField, privateFields) => (
  !isDescendantOfAny(requestedField, privateFields)
)

function validateProjection (query) {
  query.projection = query.projection || {};

  // Remove exclusions since projection cannot have a mix of inclusion and exclusion:
  query.projection = filterObject(query.projection, (key, value) => value === 1);

  // Remove projection if it or its (grand-)parent is in PRIVATE_FIELDS:
  query.projection = filterObject(query.projection, (key, value) => isPublic(key, PRIVATE_FIELDS));

  // Do not return ID
  query.projection._id = 0;

  // Always return COMPULSORY_FIELDS
  for (let i = 0; i < COMPULSORY_FIELDS.length; i += 1) {
    query.projection[COMPULSORY_FIELDS[i]] = 1;
  }
}

function addSearchQuery (query, searchTerm) {

  if (!searchTerm) {
    return;
  }

  // Perform AND text-search on charity name:
  var quotedWords = '"' + searchTerm.split('"').join('').split(' ').join('" "') + '"';
  query.filter["$text"] = { "$search" : quotedWords };

  // Project text-match score:
  query.projection.score = { "$meta" : "textScore" };

  // If no sorting specified, sort by score:
  if (!query.sort) {
    query.sort = {
      score : { "$meta" : "textScore" }
    };
  }

}

function addDefaultSort (query) {
  if (!query.sort) {
    query.sort = {
      charityNumber : 1,
      subNumber: 1
    };
  }
}

function validateLimit(query, defaultLimit, maxLimit) {
  if (query.limit > maxLimit) {
    query.limit = maxLimit;
  } else {
    query.limit = query.limit > 0 ? query.limit : defaultLimit;
  }
}

function validateSkip(query) {
  query.skip = query.skip > -1 ? query.skip : 0;
}

module.exports.getCharities = function (req, res) {
  if (req.params.version !== LATEST_VERSION) {
    return res.status(400).send({
      message: `You requested version ${req.params.version} but only the latest version ${LATEST_VERSION} is supported`
    });
  }

  var query = aqp.default(req.query, {
    // whitelist only allows filters on these fields (not including their children)
    whitelist: ['charityNumber', 'subNumber', 'registered', 'mainCharity.income']
  });
  // Note: the following accepted query parameters are not processed by aqp: ['search', 'countResults']

  validateProjection(query);

  addSearchQuery(query, req.query.search);

  addDefaultSort(query);

  validateLimit(query, defaultLimit=10, maxLimit=50);

  validateSkip(query);


  return Promise.resolve(
    req.query.hasOwnProperty('countResults')
  )
  .then((countResults) => {
    if (!countResults) {
      return null;
    }
    return Charity
    .count(query.filter)
    .exec(function (err, count) {
      if (err) {
        return res.status(400).send(err);
      }
      return count;
    });
  })
  .then((count) => {
    return Charity
    .find(query.filter)
    .select(query.projection)
    .sort(query.sort)
    .skip(query.skip)
    .limit(query.limit)
    .exec(function (err, charities) {
      if (err) {
        return res.status(400).send(err);
      }
      return res.send({
        version : LATEST_VERSION,
        totalMatches : count,
        query : query,
        charities : charities
      });
    });
  });
}
