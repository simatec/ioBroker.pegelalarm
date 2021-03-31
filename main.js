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

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();
const axios = require('axios').default;

let isStopped = false;
let adapter;
let stopTimeout;
let currentStations = [];
let allStationsJSON = [];

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */

function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName, useFormatDate: true, });

    adapter = new utils.Adapter(options);

    // start here!
    adapter.on('ready', main); // Main method defined below for readability

    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', (callback) => {
        try {
            adapter.log.debug('cleaned everything up...');
            stopSwitchTimeout && clearTimeout(stopSwitchTimeout);
            stopSwitchTimeout = null;
            stopTimeout && clearTimeout(stopTimeout);
            stopTimeout = null;
            callback();
        } catch (e) {
            callback();
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (state) {
            // The state was changed
            adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            adapter.log.debug(`state ${id} deleted`);
        }
    });

    return adapter;
}

// Request Data from API
async function requestData(_stationname, _region, _water, _num) {
    let dataUrl = "https://api.pegelalarm.at/api/station/1.0/list";
    dataUrl += "?countryCode=" + adapter.config.country;

    if (_region.trim().length) {
        dataUrl += "&qRegion=" + _region;
    }
    if (_water.trim().length) {
        dataUrl += "&qWater=" + _water;
    }
    if (_stationname.trim().length) {
        dataUrl += "&qStationName=" + _stationname;
    }
    const url = encodeURI(dataUrl);

    adapter.log.debug(url);

    let available;
    try {
        available = await axios({
            method: 'get',
            baseURL: url,
            validateStatus: () => true
        });
    } catch (err) {
        adapter.log.debug('Grafana is not available: ' + err)
    }
    if (available && available.status) {
        adapter.log.debug('Pegelalarm API is available ... Status: ' + available.status)

        const dataRequest = await axios({
            method: 'get',
            baseURL: url,
            responseType: 'json'
        });

        let data = dataRequest.data;

        if (typeof data == 'object' && data.hasOwnProperty("status") && data.status.hasOwnProperty("code") && data.hasOwnProperty("payload") && data.payload.hasOwnProperty("stations")) {
            if (data.status.code == '200') {
                let warnings = [];
                let alerts = [];

                for (let i = 0; i < data.payload.stations.length; i++) {
                    let station = data.payload.stations[i];
                    let path = 'stations.' + createVarName(station.stationName);
                    currentStations.push(createVarName(station.stationName));

                    await createStations(path);

                    await adapter.setState(path + '.name', station.stationName, true);
                    await adapter.setState(path + '.country', station.country, true);
                    await adapter.setState(path + '.water', station.water, true);
                    await adapter.setState(path + '.region', station.region, true);
                    await adapter.setState(path + '.situation.text', decodeSituation(station.situation), true);
                    await adapter.setState(path + '.situation.group', decodeSituation(station.situation, "group"), true);
                    await adapter.setState(path + '.situation.code', station.situation, true);
                    await adapter.setState(path + '.trend.text', decodeTrend(station.trend), true);
                    await adapter.setState(path + '.trend.short', decodeTrend(station.trend, "short"), true);
                    await adapter.setState(path + '.trend.code', station.trend, true);

                    let stateNormal = false;
                    let stateWarning = false;
                    let stateAlert = false;
                    let stateUnknown = false;

                    switch (decodeSituation(station.situation, "group")) {
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

                    await adapter.setState(path + '.state.normal', stateNormal, true);
                    await adapter.setState(path + '.state.warning', stateWarning, true);
                    await adapter.setState(path + '.state.alert', stateAlert, true);
                    await adapter.setState(path + '.state.unknown', stateUnknown, true);
                    await adapter.setState(path + '.geo.latitude', station.latitude, true);
                    await adapter.setState(path + '.geo.longitude', station.longitude, true);
                    await adapter.setState(path + '.geo.altitude', station.altitudeM, true);

                    let height = 0;

                    for (let o = 0; o < station.data.length; o++) {
                        let stationData = station.data[o];
                        if (stationData.type == "height in cm") {
                            o = station.data.length;

                            await adapter.setState(path + '.height', { val: stationData.value, ack: true });
                            height = stationData.value;

                            let sourceDate = new Date(Date.parse(stationData.sourceDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, "$3-$2-$1$4"))).toUTCString();
                            await adapter.setState(path + '.sourceDate', sourceDate, true);

                            let requestDate = new Date(Date.parse(stationData.requestDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, "$3-$2-$1$4"))).toUTCString();
                            await adapter.setState(path + '.requestDate', requestDate, true);
                        }
                    }

                    // created json
                    let json = ({
                        "stationsname": station.stationName,
                        "region": station.region,
                        "country": station.country,
                        "water": station.water,
                        "height": height,
                        "trend": decodeTrend(station.trend, "short"),
                        "warning": stateWarning,
                        "alert": stateAlert
                    });
                    allStationsJSON.push(json);

                    await adapter.setState(path + '.json', { val: JSON.stringify(json), ack: true });

                }

                await adapter.setState('allStationsJSON', { val: JSON.stringify(allStationsJSON), ack: true });

                await adapter.setState('warning.hasWarning', (warnings.length > 0), true);
                await adapter.setState('warning.statepathes', JSON.stringify(warnings), true);
                await adapter.setState('alert.hasAlert', (alerts.length > 0), true);
                await adapter.setState('alert.statepathes', JSON.stringify(alerts), true);

                let lastRun = new Date().toUTCString();

                await adapter.setState('lastRun', lastRun, true);
            } else {
                adapter.log.error('API-Statuscode: ' + data.status.code);
                //stopAdapter();
            }
        } else {
            adapter.log.error('Wrong JSON returned');
            //stopAdapter();
        }
    } else {
        adapter.log.error('Cannot read JSON file: ' + error || response.statusCode);
        //stopAdapter();
    }
    //stopAdapter();

    adapter.log.debug("Pegelalarm request done");
}

function createStations(path) {
    return new Promise((resolve, reject) => {
        const stationsStatesString = [
            'country',
            'name',
            'region',
            'water',
            'json',
            'situation.group',
            'situation.text',
            'trend.short',
            'trend.text'
        ];
        const stationsStatesNumber = [
            'height',
            'geo.altitude',
            'geo.latitude',
            'geo.longitude',
            'situation.code',
            'trend.code',
        ];
        const stationsStatesDate = [
            'requestDate',
            'sourceDate'
        ]
        const stationsStatesboolean = [
            'state.alert',
            'state.normal',
            'state.unknown',
            'state.warning',
        ];
        const stationsChannel = [
            'state',
            'geo',
            'situation',
            'trend',
        ];

        adapter.setObjectNotExists('stations', {
            type: 'channel',
            common: {
                name: 'stations',
            },
            native: {},
        });
        for (const j in stationsChannel) {
            adapter.setObjectNotExists(path + '.' + stationsChannel[j], {
                type: 'channel',
                common: {
                    name: stationsChannel[j],
                },
                native: {},
            });
        }
        for (const k in stationsStatesString) {
            adapter.setObjectNotExists(path + '.' + stationsStatesString[k], {
                type: 'state',
                common: {
                    name: stationsStatesString[k],
                    type: 'string',
                    role: stationsStatesString[k] == 'json' ? 'json' : 'text',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        for (const l in stationsStatesNumber) {
            adapter.setObjectNotExists(path + '.' + stationsStatesNumber[l], {
                type: 'state',
                common: {
                    name: stationsStatesNumber[l],
                    type: 'number',
                    role: 'value',
                    unit: stationsStatesNumber[l] == 'height' ? 'cm' : '',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        for (const m in stationsStatesDate) {
            adapter.setObjectNotExists(path + '.' + stationsStatesDate[m], {
                type: 'state',
                common: {
                    name: stationsStatesDate[m],
                    type: 'string',
                    role: 'date',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        for (const n in stationsStatesboolean) {
            adapter.setObjectNotExists(path + '.' + stationsStatesboolean[n], {
                type: 'state',
                common: {
                    name: stationsStatesboolean[n],
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        const timer = setTimeout(() => {
            resolve();
            clearTimeout(timer);
        }, 2000);
    });
}

function decodeTrend(code, type = "") {
    let text = "Unknown water level";
    let shortText = "unknown";

    switch (code) {
        case -10:
            text = "Falling water level";
            shortText = "falling";
            break;
        case 0:
            text = "Constant water height";
            shortText = "constant";
            break;
        case 10:
            text = "Rising water level";
            shortText = "rising";
            break;
        default:
            text = "Unknown water level";
            shortText = "unknown";
    }

    if (type.length && type == "short") {
        return shortText;
    }

    return text;
}

function decodeSituation(code, type = "") {
    let text = "Unknown water level";
    let group = "unknown";

    switch (code) {
        case -10:
            text = "Under or normal water level";
            group = "normal";
            break;
        case 10:
            text = "Normal or slightly elevated water level";
            group = "normal";
            break;
        case 20:
            text = "Increased water level";
            group = "normal";
            break;
        case 30:
            text = "The water level has reached the warning limit";
            group = "warning";
            break;
        case 40:
            text = "The water level causes a regional flood";
            group = "alert";
            break;
        case 50:
            text = "Water level causes a national flood";
            group = "alert";
            break;
        default:
            text = "Unknown situation";
            group = "unknown";
    }

    if (type.length && type == "group") {
        return group;
    }

    return text;
}

function createVarName(text) {
    return text.toLowerCase().replace(/\s/g, '_').replace(/[^\x20\x2D0-9A-Z\x5Fa-z\xC0-\xD6\xF8-\xFF]/g, '');
}

function stopAdapter() {
    setImmediate(() => {
        stopSwitchTimeout && clearTimeout(stopSwitchTimeout);
        isStopped = true;
        stopTimeout = setTimeout(() => {
            adapter.stop ? adapter.stop() : adapter.terminate();
        }, 20000);
    });
}

let stopSwitchTimeout = setTimeout(() => {
    stopSwitchTimeout = null;
    if (!isStopped) {
        adapter && adapter.log && adapter.log.info('force terminating after 4 minutes');
        adapter && adapter.stop && adapter.stop();
    }
}, 240000);

function checkStation(currentStations) {
    adapter.getForeignObjects(adapter.namespace + ".stations.*", 'state', /**
         * @param {any} err
         * @param {any[]} list
         */
        function (err, list) {
            if (err) {
                adapter.log.error(err);
            } else {
                for (const i in list) {
                    const resID = list[i]._id;
                    const objectID = resID.split('.');
                    const resultID = objectID[3];

                    if (currentStations.indexOf(resultID) === -1) {
                        adapter.log.debug('DELETE: ' + resID);
                        adapter.delObject(resID, /**
                         * @param {any} err
                         */
                            function (err) {
                                if (err) {
                                    adapter.log.warn(err);
                                }
                            });
                    }

                }
            }
        });
    adapter.getForeignObjects(adapter.namespace + ".stations.*", 'channel', /**
         * @param {any} err
         * @param {any[]} list
         */
        function (err, list) {
            if (err) {
                adapter.log.error(err);
            } else {
                for (const i in list) {
                    const resID = list[i]._id;
                    const objectID = resID.split('.');
                    const resultID = objectID[3];

                    if (currentStations.indexOf(resultID) === -1) {
                        adapter.log.debug('DELETE: ' + resID);
                        adapter.delObject(resID, /**
                         * @param {any} err
                         */
                            function (err) {
                                if (err) {
                                    adapter.log.warn(err);
                                }
                            });
                    }

                }
            }
        });
}
function main() {
    if (adapter.config.configurated !== 0) {
        let num = 0
        for (let i = 0; i < 5; i++) {
            setTimeout(function () {
                if (adapter.config[`stationname${num}`] || adapter.config[`region${num}`] || adapter.config[`water${num}`]) {
                    adapter.log.debug(num + ' Pegelalarm request started ...');
                    requestData(adapter.config[`stationname${num}`], adapter.config[`region${num}`], adapter.config[`water${num}`], num);
                }

                if (num === 4) {
                    setTimeout(function () {
                        checkStation(currentStations);
                        stopAdapter();
                    }, 10000);
                }
                num++;
            }, 10000 * i, i);
        }
    } else {
        adapter.log.error('Please configurate Adapter first!');
        stopAdapter();
    }
}
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}