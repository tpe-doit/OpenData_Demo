var request = require('request');
var Promise = require('bluebird');
var shellescape = require('shell-escape');
var child_process = require('child_process');
var Redis = require('redis');
Promise.promisifyAll(Redis.RedisClient.prototype);
Promise.promisifyAll(Redis.Multi.prototype);
var redis = Redis.createClient();

function fetch_json_gz(url) {
  return new Promise(function(resolve, reject) {
    child_process.exec(
      [shellescape(['curl', '-L', url]), '|', 'gunzip -c'].join(' '),
      {
        maxBuffer: 10 * 1024 * 1024
      },
      function(err, stdout, stderr) {
        resolve(JSON.parse(stdout));
      }
    );
  })
}

var data_sets = {
  stop: 'http://data.taipei/bus/Stop',
  route: 'http://data.taipei/bus/ROUTE',
  estimate: 'http://data.taipei/bus/EstimateTime'
};

var sequelize;

var Bus = function(sequelize_instance) {
  sequelize = sequelize_instance;
}

Bus.prototype.fetch = {
  route: function() {
    return new Promise(function(resolve, reject) {
      fetch_json_gz(data_sets.route).then(function(data) {
        new Promise.all(data.BusInfo.map(function(row) {
          return sequelize.query(
            'INSERT INTO `route` (`id`, `name`, `departure`, `destination`) VALUES(:id, :name, :departure, :destination) ON DUPLICATE KEY UPDATE `name` = :name, `departure` = :departure, `destination` = :destination', {
              replacements: {
                id: row.Id,
                name: row.nameZh,
                departure: row.departureZh,
                destination: row.destinationZh
              },
              type: sequelize.QueryTypes.INSERT
            }
          );
        })).then(resolve);
      });
    });
  },
  stop: function() {
    return new Promise(function(resolve, reject) {
      fetch_json_gz(data_sets.stop).then(function(data) {
        new Promise.all(data.BusInfo.map(function(row) {
          return sequelize.query(
            'INSERT INTO `stop` (`id`, `seq`, `name`, `route_id`, `back`) VALUES(:id, :seq, :name, :route_id, :back) ON DUPLICATE KEY UPDATE `seq` = :seq, `name` = :name, `route_id` = :route_id, `back` = :back', {
              replacements: {
                id: row.Id,
                seq: row.seqNo,
                name: row.nameZh,
                route_id: row.routeId,
                back: row.goBack
              },
              type: sequelize.QueryTypes.INSERT
            }
          );
        })).then(resolve);
      });
    });
  },
  estimate: function() {
console.log("start");
    return new Promise(function(resolve, reject) {
count_estimate=0;
      fetch_json_gz(data_sets.estimate).then(function(data) {
        new Promise.all(data.BusInfo.map(function(row) {
count_estimate++;
          return redis.setAsync(row.StopID, row.EstimateTime);
        })).then(function() {
console.log(count_estimate);
          return resolve();
        });
      });
    });
  }
};

Bus.prototype.search = {
  route: function(name) {
    return sequelize.query(
      'SELECT * FROM `route` WHERE `name` = :name', {
        replacements: {
          name: name
        },
        type: sequelize.QueryTypes.SELECT
      }
    );
  },
  stop: function(offset, back, route_id) {
    return sequelize.query(
      'SELECT * FROM `stop` WHERE `route_id` = :route_id AND `back` = :back ORDER BY `seq` ASC LIMIT ' + parseInt(offset) + ',1', {
        replacements: {
          back: back,
          route_id: route_id
        },
        type: sequelize.QueryTypes.SELECT
      }
    );
  }
};

Bus.prototype.list = {
  stop: function(back, route_id) {
    return sequelize.query(
      'SELECT `name` FROM `stop` WHERE `route_id` = :route_id AND `back` = :back ORDER BY `seq` ASC', {
        replacements: {
          back: back,
          route_id: route_id
        },
        type: sequelize.QueryTypes.SELECT
      }
    );
  }
};

Bus.prototype.estimate = function(stop_id) {
  return redis.getAsync(stop_id);
};

module.exports = Bus;
