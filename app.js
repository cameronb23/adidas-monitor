const request = require('request-promise');
const async = require('async');

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
  // TODO: load config
  // TODO: start async process of scanning all PIDs


  let intervalPid = setInterval(() => {
    let tasks = [];

    Config.adidas.pids.forEach((pid) => {
      Object.keys(sitesMap).forEach((region) => {
        tasks.push(function() {
          getStock(region, pid);
        })
      })
    });

    async.parallel(tasks);
  }, 5000);
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

  /**

  let atc = "";

  let newField = true;
  let fieldIndex = -1;

  let fields = [];

  for(let i = 0; i < sizes.length; i++) {
    if(i % 3 === 0) {
      newField = true;
    }

    if(newField) {
      newField = false;
      let str = fields[fieldIndex].trim();
      fields[fieldIndex] = str.substr(0, str.length - 1);

      fieldIndex++;
      fields[fieldIndex] += `Size ${sizes[i].size}: ${sizes[i].stock} | `;
    } else {
      fields[fieldIndex] += `Size ${sizes[i].size}: ${sizes[i].stock} | `;
    }
  }

  fields.forEach((f) => {
    format["fields"].push({
    })
  })
  */

  let atc = "";

  sizes.forEach((size) => {
    format["fields"].push({
      "name": size.size,
      "value": size.stock
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
        // product not loaded
        // console.log(`[${region}][${pid}] Product not loaded`);
        sitesMap[region].last[pid] = 'oos';
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
          if(variant.inStock && variant.avStatus === 'IN_STOCK') {
            newStock.push(makeCacheVariant(variant));
          }
        });

        sitesMap[region].last[pid] = newStock;
        return [];
      }

      if(sitesMap[region].last[pid] === 'oos') {
        array.forEach((variant) => {
          if(variant.inStock && variant.avStatus === 'IN_STOCK') {
            newStock.push(makeCacheVariant(variant));
          }
        });

        sitesMap[region].last[pid] = newStock;
        return newStock;
      }


      let oldVariants = sitesMap[region].last[pid];

      array.forEach((variant) => {
        // we have a scan already, lets reference our values.

        let isNew = false;

        let old = oldVariants.filter(v => v.size === variant.attributes.size);
        if(old.length > 0) {
          old = old[0];

          if((old.inStock === 'false') && variant.inStock) {
            isNew = true;
          }

          if((old.avStatus !== 'IN_STOCK') && variant.avStatus === 'IN_STOCK') {
            isNew = true;
          }
        }

        if(isNew) {
          console.log("OLD:" + old);
          console.log("NEW: " + variant);
          newStock.push(makeCacheVariant(variant));
        }
      });

      sitesMap[region].last[pid] = newStock;

      return newStock;
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
      if(Config.discord.enabled) {
        alertDiscordWebhook(prepareDiscordEmbed(region, pid, map));
      }

      if(Config.slack.enabled) {
        // do some shit
      }
    }
  })
  .catch((err) => {
    console.log(`[${region}][${pid}] Out of Stock`);
    console.log(err);
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
