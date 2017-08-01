const request = require('request-promise');
const async = require('async');
const _ = require('lodash');

const Config = require('./config.json');


const STOCK_ENDPOINT = "Product-GetVariants?pid=";

var sitesMap = {
  us: {
    url: "https://www.adidas.com/on/demandware.store/Sites-adidas-US-Site/en_US/",
    last: {}
  },
  uk: {
    url: "https://www.adidas.co.uk/on/demandware.store/Sites-adidas-GB-Site/en_GB/",
    last: {}
  },
  au: {
    url: "https://www.adidas.com.au/on/demandware.store/Sites-adidas-AU-Site/en_AU/",
    last: {}
  }
};

start();

function start() {

  let intervalPid = setInterval(() => {
    let tasks = [];

    Config.main.pids.forEach((pid) => {
      Object.keys(sitesMap).forEach((region) => {
        tasks.push(function() {
          getStock(region, pid);
        })
      })
    });

    async.parallel(tasks);
  }, Config.main.interval * 1000);
}



function makeCacheVariant(variant) {
  return {
    size: variant.attributes.size,
    code: variant.id.split('_')[1],
    inStock: variant.inStock,
    avStatus: variant.avStatus,
    stock: variant.ATS
  }
}


function prepareDiscordEmbed(region, pid, sizes) {

  let timeStamp = new Date().toISOString();

  let baseUrl = sitesMap[region].url;
  if(baseUrl.endsWith('/'))
    baseUrl = baseUrl.substr(0, baseUrl.length - 1);
  //let url = `${baseUrl}/cameron-is-washed/${pid}.html`;
  let url = `${baseUrl}/Product-Show?pid=%20${pid}`;

  let format = {
    "title": `Adidas ${region.toUpperCase()} Restock`,
    "description": `Product ID: ${pid}`,
    "url": url,
    "color": "518151",
    "timestamp": timeStamp,
    "footer": {
      "text": "Powered by cameron#9648"
    },
    "author": {
      "name": "Adidas Monitor",
      "url": url,
      "icon_url": `https://www.google.com/s2/favicons?domain=${baseUrl}`
    },
    "fields": [
      {
        "name": "Product Page",
        "value": url
      }
    ]
  }

  let atc = "";

  sizes.forEach((size) => {
    format["fields"].push({
      "name": size.size,
      "value": size.stock
    });
  });


  return format;
}


function prepareSlackAttachment(region, pid, sizes) {
  let baseUrl = sitesMap[region].url.split('/on/')[0];

  let link = sitesMap[region].url + STOCK_ENDPOINT + pid;

  let format = {
    attachments: [
      {
        fallback: `Adidas ${region.toUpperCase()} restocked ${pid}`,
        color: "#36a64f",
        author_name: `Adidas ${region.toUpperCase()}`,
        author_link: baseUrl,
        author_icon: `https://www.google.com/s2/favicons?domain=${baseUrl}`,
        title: `${pid} Restocked`,
        title_link: link,
        fields: [],
        footer: "Powered by @cgalt23",
        footer_icon: `https://www.google.com/s2/favicons?domain=${baseUrl}`,
        ts: new Date().toISOString()
      }
    ]
  };

  sizes.forEach((size) => {
    format.attachments[0]["fields"].push({
      title: size.size,
      value: size.stock,
      short: true
    });
  });

  return format;
}



function getStock(region, pid) {

  let baseUrl = sitesMap[region].url;

  // make sure we format the url correctly.
  if(!baseUrl.endsWith('/'))
    baseUrl += "/";

  let fullUrl = baseUrl + STOCK_ENDPOINT + pid;

  let opts = {
    url: fullUrl,
    method: 'GET',
    json: true,
    transform: function(json) {
      // we will transform the json to suit our needs here.

      if(typeof json === 'string') {
        // product not loaded OR adidas on some fuck shit
        // console.log(`[${region}][${pid}] Product not loaded`);
        return [];
      }

      if(json.variations == null || json.variations.variants == null) {
        return [];
      }

      let array = json.variations.variants;

      let newStock = [];

      if(sitesMap[region].last[pid] == null) {
        // no old scan so lets just push to our data and stop
        array.forEach((variant) => {
          newStock.push(makeCacheVariant(variant));
        });

        sitesMap[region].last[pid] = newStock;
        return [];
      }

      // if(sitesMap[region].last[pid] === 'oos') {
      //   console.log('last check we got not loaded');
      //   array.forEach((variant) => {
      //     newStock.push(makeCacheVariant(variant));
      //   });
      //
      //   sitesMap[region].last[pid] = newStock;
      //   return newStock;
      // }


      let oldVariants = sitesMap[region].last[pid];

      let restocks = [];

      array.forEach((variant) => {
        // we have a scan already, lets reference our values.
        let isNew = false;
        let isRestock = false;

        let old = oldVariants.filter(v => v.size === variant.attributes.size);
        if(old.length > 0) {
          old = old[0];
          let newObj = makeCacheVariant(variant);

          if(!_.isEqual(old, newObj)) {
            isNew = true;
            if((old.inStock === 'false') && variant.inStock) {
              isRestock = true;
            }

            if((old.avStatus !== 'IN_STOCK') && variant.avStatus === 'IN_STOCK') {
              isRestock = true;
            }
          }
        }

        if(isNew) {
          console.log("OLD:" + old);
          console.log("NEW: " + newObj);
          newStock.push(newObj);
        }

        if(isRestock) {
          console.log("OLD:" + old);
          console.log("NEW: " + newObj);
          restocks.push(newObj);
        }
      });

      sitesMap[region].last[pid] = newStock;

      return restocks;
    }
  }



  request(opts)
  .then((sizes) => {

    let map = [];

    sizes.forEach((s) => {
      if(s.stock > 0) {
        map.push(s);
      }
    });

    if(map.length > 0) {
      if(Config.discord.enabled === 'true') {
        alertDiscordWebhook(prepareDiscordEmbed(region, pid, map));
      }

      if(Config.slack.enabled === 'true') {
        // do some shit
        alertSlackWebhook(prepareSlackAttachment(region, pid, map));
      }
    }
  })
  .catch((err) => {
    console.log(`[${region}][${pid}] Not loaded, or adidas is messing with us`);
  });

}


function alertDiscordWebhook(embed) {
  let baseUrl = "https://discordapp.com/api/webhooks";

  let url = baseUrl + `/${Config.discord.webhook.id}/${Config.discord.webhook.token}`;


  let opts = {
    url: url,
    method: 'POST',
    json: {
      embeds: [
        embed
      ]
    }
  }

  request(opts)
  .then((body) => {
    console.log("Successfully sent webhook request to Discord");
  })
  .catch((err) => {
    console.log("Error sending webhook request to discord.");
    console.log(err);
  });
}

function alertSlackWebhook(payload) {
  let url = Config.slack.webhook_url;

  let opts = {
    url: url,
    method: 'POST',
    json: payload
  }

  request(opts)
  .then((body) => {
    console.log("Successfully sent incoming webhook to Slack");
  })
  .catch((err) => {
    console.log("Error sending incoming webhook to slack.");
    console.log(err);
  });
}
