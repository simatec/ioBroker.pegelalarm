/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */

// trend
// ---------------------------------------------
// | Code | Description           | Short text |
// ---------------------------------------------
// | -10  | Fallende Wasserhöhe   | Falling    |
// ---------------------------------------------
// | 0    | Konstante Wasserhöhe  | Constant   |
// ---------------------------------------------
// | 10   | Steigende Wasserhöhe  | Rising     |
// ---------------------------------------------
// | 100  | Unbekannte Wasserhöhe | Unknown    |
// ---------------------------------------------

// situation
// ------------------------------------------------------------------------------
// | Code | Description                                      | Group   | Color  |
// ------------------------------------------------------------------------------
// | -10  | Unter- oder Normalwasserstand                    | normal  | green  |
// ------------------------------------------------------------------------------
// | 10   | Normal- oder leicht erhöhter Wasserstand         | normal  | green  |
// ------------------------------------------------------------------------------
// | 20   | Erhöhter Wasserstand                             | normal  | green  |
// ------------------------------------------------------------------------------
// | 30   | Wasserstand hat Warngrenze erreicht              | warning | yellow |
// ------------------------------------------------------------------------------
// | 40   | Wasserstand verursacht ein regionales Hochwasser | alert   | red    |
// ------------------------------------------------------------------------------
// | 50   | Wasserstand verursacht ein nationales Hochwasser | alert   | red    |
// ------------------------------------------------------------------------------
// | 100  | Unknown situation                                | unknown | blue   |
// ------------------------------------------------------------------------------

'use strict';

const utils       = require('@iobroker/adapter-core'); // Get common adapter utils
const tools       = require('./lib/tools');
const adapterName = require('./package.json').name.split('.').pop();
const request     = require('request');

let channels = [];
let iopkg;
let isStopped = false;
let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: adapterName,
        useFormatDate: true,
        unload: cb => {
            killSwitchTimeout && clearTimeout(killSwitchTimeout);
            killSwitchTimeout = null;
            cb && cb();
        }
    });
    adapter = new utils.Adapter(options);

    adapter.on('ready', () => {
        adapter.log.debug("started");

        if(!adapter.config.configurated){
            adapter.log.error("Please configurate Adapter first!");
            killAdapter();
        }

        let dataUrl = "https://api.pegelalarm.at/api/station/1.0/list";
        dataUrl += "?countryCode=" + adapter.config.country;

        if(adapter.config.region.trim().length){
            dataUrl += "&qRegion="+adapter.config.region;
        }
        if(adapter.config.water.trim().length){
            dataUrl += "&qWater="+adapter.config.water;
        }
        if(adapter.config.stationname.trim().length){
            dataUrl += "&qStationName="+adapter.config.stationname;
        }

        adapter.log.debug(dataUrl);

        request({
            method: 'GET',
            rejectUnauthorized: false,
            url: dataUrl
        }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                let data = JSON.parse(body);
                if(typeof data == 'object' && data.hasOwnProperty("status") && data.status.hasOwnProperty("code") && data.hasOwnProperty("payload") && data.payload.hasOwnProperty("stations")){
                    if(data.status.code == '200'){
                        let warnings = [];
                        let alerts = [];

                        for (let i = 0; i < data.payload.stations.length; i++) {
                            let station = data.payload.stations[i];
                            let path = 'stations.'+createVarName(station.stationName);

                            adapter.setObjectNotExists('stations', {
                                type: 'channel',
                                common: {
                                    name: 'stations',
                                },
                                native: {},
                            });

                            adapter.setObjectNotExists(path+'.name', {
                                type: 'state',
                                common: {
                                    name: 'name',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.name', station.stationName);

                            adapter.setObjectNotExists(path+'.country', {
                                type: 'state',
                                common: {
                                    name: 'country',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.country', station.country);

                            adapter.setObjectNotExists(path+'.water', {
                                type: 'state',
                                common: {
                                    name: 'water',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.water', station.water);

                            adapter.setObjectNotExists(path+'.region', {
                                type: 'state',
                                common: {
                                    name: 'region',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.region', station.region);

                            adapter.setObjectNotExists(path+'.situation', {
                                type: 'channel',
                                common: {
                                    name: 'situation',
                                },
                                native: {},
                            });

                            adapter.setObjectNotExists(path+'.situation.text', {
                                type: 'state',
                                common: {
                                    name: 'text',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.situation.text', decodeSituation(station.situation));

                            adapter.setObjectNotExists(path+'.situation.group', {
                                type: 'state',
                                common: {
                                    name: 'group',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.situation.group', decodeSituation(station.situation, "group"));

                            adapter.setObjectNotExists(path+'.situation.code', {
                                type: 'state',
                                common: {
                                    name: 'code',
                                    type: 'number',
                                    role: 'value',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.situation.code', station.situation);

                            adapter.setObjectNotExists(path+'.trend', {
                                type: 'channel',
                                common: {
                                    name: 'trend',
                                },
                                native: {},
                            });

                            adapter.setObjectNotExists(path+'.trend.text', {
                                type: 'state',
                                common: {
                                    name: 'text',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.trend.text', decodeTrend(station.trend));

                            adapter.setObjectNotExists(path+'.trend.short', {
                                type: 'state',
                                common: {
                                    name: 'short',
                                    type: 'string',
                                    role: 'text',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.trend.short', decodeTrend(station.trend, "short"));

                            adapter.setObjectNotExists(path+'.trend.code', {
                                type: 'state',
                                common: {
                                    name: 'code',
                                    type: 'number',
                                    role: 'value',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.trend.code', station.trend);

                            adapter.setObjectNotExists(path+'.state', {
                                type: 'channel',
                                common: {
                                    name: 'state',
                                },
                                native: {},
                            });

                            let stateNormal = false;
                            let stateWarning = false;
                            let stateAlert = false;
                            let stateUnknown = false;

                            switch(decodeSituation(station.situation, "group")) {
                                case 'normal':
                                    stateNormal = true;
                                    break;
                                case 'warning':
                                    stateWarning = true;
                                    warnings.push(path);
                                    break;
                                case 'alert':
                                    stateAlert = true;
                                    alerts.push(path);
                                    break;
                                default:
                                    stateUnknown = true;
                            }

                            adapter.setObjectNotExists(path+'.state.normal', {
                                type: 'state',
                                common: {
                                    name: 'normal',
                                    type: 'boolean',
                                    role: 'indicator',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.state.normal', stateNormal);

                            adapter.setObjectNotExists(path+'.state.warning', {
                                type: 'state',
                                common: {
                                    name: 'warning',
                                    type: 'boolean',
                                    role: 'indicator',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.state.warning', stateWarning);

                            adapter.setObjectNotExists(path+'.state.alert', {
                                type: 'state',
                                common: {
                                    name: 'alert',
                                    type: 'boolean',
                                    role: 'indicator',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.state.alert', stateAlert);

                            adapter.setObjectNotExists(path+'.state.unknown', {
                                type: 'state',
                                common: {
                                    name: 'unknown',
                                    type: 'boolean',
                                    role: 'indicator',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.state.unknown', stateUnknown);

                            adapter.setObjectNotExists(path+'.geo', {
                                type: 'channel',
                                common: {
                                    name: 'geo',
                                },
                                native: {},
                            });

                            adapter.setObjectNotExists(path+'.geo.latitude', {
                                type: 'state',
                                common: {
                                    name: 'latitude',
                                    type: 'number',
                                    role: 'value.gps.latitude',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.geo.latitude', station.latitude);

                            adapter.setObjectNotExists(path+'.geo.longitude', {
                                type: 'state',
                                common: {
                                    name: 'longitude',
                                    type: 'number',
                                    role: 'value.gps.longitude',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.geo.longitude', station.longitude);

                            adapter.setObjectNotExists(path+'.geo.altitude', {
                                type: 'state',
                                common: {
                                    name: 'altitude',
                                    type: 'number',
                                    role: 'value.gps.elevation',
                                    read: false,
                                    write: false,
                                },
                                native: {},
                            });
                            adapter.setState(path+'.geo.altitude', station.altitudeM);

                            for (let j = 0; j < station.data.length; j++) {
                                let stationData = station.data[j];
                                if(stationData.type == "height in cm"){
                                    j = station.data.length;

                                    adapter.setObjectNotExists(path+'.height', {
                                        type: 'state',
                                        common: {
                                            name: 'height',
                                            type: 'number',
                                            role: 'level',
                                            unit: "cm",
                                            read: false,
                                            write: false,
                                        },
                                        native: {},
                                    });
                                    adapter.setState(path+'.height', stationData.value);

                                    adapter.setObjectNotExists(path+'.sourceDate', {
                                        type: 'state',
                                        common: {
                                            name: 'sourceDate',
                                            type: 'string',
                                            role: 'date',
                                            read: false,
                                            write: false,
                                        },
                                        native: {},
                                    });
                                    let sourceDate = new Date(Date.parse(stationData.sourceDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, "$3-$2-$1$4"))).toUTCString();
                                    adapter.setState(path+'.sourceDate', sourceDate);

                                    adapter.setObjectNotExists(path+'.requestDate', {
                                        type: 'state',
                                        common: {
                                            name: 'requestDate',
                                            type: 'string',
                                            role: 'date',
                                            read: false,
                                            write: false,
                                        },
                                        native: {},
                                    });
                                    let requestDate = new Date(Date.parse(stationData.requestDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, "$3-$2-$1$4"))).toUTCString();
                                    adapter.setState(path+'.requestDate', requestDate);
                                }
                            }
                        }

                        adapter.setObjectNotExists('warning', {
                            type: 'channel',
                            common: {
                                name: 'warning',
                            },
                            native: {},
                        });

                        adapter.setObjectNotExists('warning.hasWarning', {
                            type: 'state',
                            common: {
                                name: 'hasWarning',
                                type: 'boolean',
                                role: 'indicator',
                                read: false,
                                write: false,
                            },
                            native: {},
                        });
                        adapter.setState('warning.hasWarning', (warnings.length>0));

                        adapter.setObjectNotExists('warning.statepathes', {
                            type: 'state',
                            common: {
                                name: 'statepathes',
                                type: 'string',
                                role: 'json',
                                read: false,
                                write: false,
                            },
                            native: {},
                        });
                        adapter.setState('warning.statepathes', JSON.stringify(warnings));

                        adapter.setObjectNotExists('alert', {
                            type: 'channel',
                            common: {
                                name: 'alert',
                            },
                            native: {},
                        });

                        adapter.setObjectNotExists('alert.hasAlert', {
                            type: 'state',
                            common: {
                                name: 'hasAlert',
                                type: 'boolean',
                                role: 'indicator',
                                read: false,
                                write: false,
                            },
                            native: {},
                        });
                        adapter.setState('alert.hasAlert', (alerts.length>0));

                        adapter.setObjectNotExists('alert.statepathes', {
                            type: 'state',
                            common: {
                                name: 'statepathes',
                                type: 'string',
                                role: 'json',
                                read: false,
                                write: false,
                            },
                            native: {},
                        });
                        adapter.setState('alert.statepathes', JSON.stringify(alerts));

                        let lastRun = new Date().toUTCString();
                        adapter.setObjectNotExists('lastRun', {
                            type: 'state',
                            common: {
                                name: 'lastRun',
                                type: 'string',
                                role: 'date',
                                read: false,
                                write: false,
                            },
                            native: {},
                        });
                        adapter.setState('lastRun', lastRun);
                    } else {
                        adapter.log.error('API-Statuscode: ' + data.status.code);
                        killAdapter();
                    }
                } else {
                    adapter.log.error('Wrong JSON returned');
                    killAdapter();
                }
            } else {
                adapter.log.error('Cannot read JSON file: ' + error || response.statusCode);
                killAdapter();
            }
            killAdapter();
        });

        adapter.log.debug("done");
    });

    return adapter;
}

function decodeTrend(code, type = ""){
    var text = "Unbekannte Wasserhöhe", shortText = "Unbekannt";

    switch(code) {
      case -10:
        text = "Fallende Wasserhöhe";
        shortText = "fallend";
        break;
      case 0:
        text = "Konstante Wasserhöhe";
        shortText = "konstant";
        break;
      case 10:
        text = "Steigende Wasserhöhe";
        shortText = "steigend";
        break;
      default:
        text = "Unbekannte Wasserhöhe";
        shortText = "Unbekannt";
    }

    if(type.length && type == "short"){
        return shortText;
    }

    return text;
}

function decodeSituation(code, type = ""){
    var text = "Unbekannte Wasserhöhe", group = "Unbekannt";

    switch(code) {
      case -10:
        text = "Unter- oder Normalwasserstand";
        group = "normal";
        break;
      case 10:
        text = "Normal- oder leicht erhöhter Wasserstand";
        group = "normal";
        break;
      case 20:
        text = "Erhöhter Wasserstand";
        group = "normal";
        break;
      case 30:
        text = "Wasserstand hat Warngrenze erreicht";
        group = "warning";
        break;
      case 40:
        text = "Wasserstand verursacht ein regionales Hochwasser";
        group = "alert";
        break;
      case 50:
        text = "Wasserstand verursacht ein nationales Hochwasser";
        group = "alert";
        break;
      default:
        text = "Unknown situation";
        group = "unknown";
    }

    if(type.length && type == "group"){
        return group;
    }

    return text;
}

function createVarName(text){
    return text.toLowerCase().replace(/\s/g, '_').replace(/[^\x20\x2D0-9A-Z\x5Fa-z\xC0-\xD6\xF8-\xFF]/g, '');
}

function killAdapter(){
    setImmediate(() => {
        killSwitchTimeout && clearTimeout(killSwitchTimeout);
        isStopped = true;
        adapter.stop ? adapter.stop() : adapter.terminate();
    });
}

let killSwitchTimeout = setTimeout(() => {
    killSwitchTimeout = null;
    if (!isStopped) {
        adapter && adapter.log && adapter.log.info('force terminating after 4 minutes');
        adapter && adapter.stop && adapter.stop();
    }
}, 240000);

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}