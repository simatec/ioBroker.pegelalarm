/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */

// trend
// -------------------------------------------------------------------------------
// | Code | Description                                             | Short text |
// -------------------------------------------------------------------------------
// | -10  | Falling water level                                     | Falling    |
// -------------------------------------------------------------------------------
// | 0    | Constant water height                                   | Constant   |
// -------------------------------------------------------------------------------
// | 10   | Rising water level                                      | Rising     |
// -------------------------------------------------------------------------------
// | 100  | Unknown water level                                     | Unknown    |
// -------------------------------------------------------------------------------

// situation
// -------------------------------------------------------------------------------
// | Code | Description                                       | Group   | Color  |
// -------------------------------------------------------------------------------
// | -10  | Under or normal water level                       | normal  | green  |
// -------------------------------------------------------------------------------
// | 10   | Normal or slightly elevated water level           | normal  | green  |
// -------------------------------------------------------------------------------
// | 20   | Increased water level                             | normal  | green  |
// -------------------------------------------------------------------------------
// | 30   | The water level has reached the warning limit     | warning | yellow |
// -------------------------------------------------------------------------------
// | 40   | The water level causes a regional flood | alert             | red    |
// -------------------------------------------------------------------------------
// | 50   | Water level causes a national flood | alert                 | red    |
// -------------------------------------------------------------------------------
// | 100  | Unknown situation                                 | unknown | blue   |
// -------------------------------------------------------------------------------

'use strict';

const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();
const axios = require('axios').default;

let adapter;

let currentStations = [];
let allStationsJSON = [];
let deleteOldStates = true;

let timerRequest, timerMain, timerStop; // timer variables

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */

function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName, useFormatDate: true, });

    adapter = new utils.Adapter(options);

    adapter.on('ready', main);

    adapter.on('unload', (callback) => {
        try {
            adapter.log.debug('cleaned everything up...');
            timerRequest && clearTimeout(timerRequest);
            timerMain && clearTimeout(timerMain);
            timerStop && clearTimeout(timerStop);
            callback();
        } catch (e) {
            callback();
        }
    });

    return adapter;
}

// Request Data from API
async function requestData(_stationname, _region, _water) {
    let dataUrl = 'https://api.pegelalarm.at/api/station/1.0/list';
    dataUrl += `?countryCode=${adapter.config.country}`;

    if (_region.trim().length) {
        dataUrl += `&qRegion=${_region}`;
    }
    if (_water.trim().length) {
        dataUrl += `&qWater=${_water}`;
    }
    if (_stationname.trim().length) {
        dataUrl += `&qStationName=${_stationname}`;
    }
    const url = encodeURI(dataUrl);

    adapter.log.debug(url);

    let available;
    try {
        available = await axios({
            method: 'get',
            //baseURL: url,
            url: url,
            validateStatus: () => true
        });
    } catch (err) {
        adapter.log.debug(`Pegelalarm API is not available: ${err}`);
    }
    if (available && available.status == '200') {
        adapter.log.debug(`Pegelalarm API is available ... Status: ${available.status}`);
        let data = [];
        try {
            const dataRequest = await axios({
                method: 'get',
                //baseURL: url,
                url: url,
                responseType: 'json'
            });

            data = dataRequest.data;
        } catch (err) {
            adapter.log.warn(`Pegelalarm API is not available: ${err}`);
        }

        if (_stationname !== '' && data && data.payload && data.payload['stations'].length > 1) {
            try {
                for (let d = 0; d < data.payload['stations'].length; d++) {
                    if (data.payload.stations[d].stationName !== _stationname) {
                        data.payload.stations.splice(d, 1);
                        d--;
                    }
                }
            } catch (err) {
                adapter.log.warn('cannot filter stations');
            }
        }

        if (data && data.status && data.status.code && data.status.code == '200' && data.payload && data.payload.stations) {
            let warnings = [];
            let alerts = [];

            for (let i = 0; i < data.payload.stations.length; i++) {
                let station = data.payload.stations[i];
                let path = `stations.${station.stationName.toLowerCase().replace(/\s/g, '_').replace(/[^\x20\x2D0-9A-Z\x5Fa-z\xC0-\xD6\xF8-\xFF]/g, '')}`;
                currentStations.push(station.stationName.toLowerCase().replace(/\s/g, '_').replace(/[^\x20\x2D0-9A-Z\x5Fa-z\xC0-\xD6\xF8-\xFF]/g, ''));

                await createStations(path);

                await adapter.setStateAsync(path + '.name', station.stationName ? station.stationName : 'none', true);
                await adapter.setStateAsync(path + '.country', station.country ? station.country : 'none', true);
                await adapter.setStateAsync(path + '.water', station.water ? station.water : 'none', true);
                await adapter.setStateAsync(path + '.region', station.region ? station.region : 'none', true);
                await adapter.setStateAsync(path + '.situation.text', station.situation ? decodeSituation(station.situation) : 'none', true);
                await adapter.setStateAsync(path + '.situation.group', station.situation ? decodeSituation(station.situation, 'group') : 'none', true);
                await adapter.setStateAsync(path + '.situation.code', station.situation ? station.situation : 0, true);
                await adapter.setStateAsync(path + '.trend.text', station.trend ? decodeTrend(station.trend) : 'none', true);
                await adapter.setStateAsync(path + '.trend.short', station.trend ? decodeTrend(station.trend, 'short') : 'none', true);
                await adapter.setStateAsync(path + '.trend.code', station.trend ? station.trend : 0, true);

                let stateNormal = false;
                let stateWarning = false;
                let stateAlert = false;
                let stateUnknown = false;

                switch (decodeSituation(station.situation, 'group')) {
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

                await adapter.setStateAsync(path + '.state.normal', stateNormal ? stateNormal : false, true);
                await adapter.setStateAsync(path + '.state.warning', stateWarning ? stateWarning : false, true);
                await adapter.setStateAsync(path + '.state.alert', stateAlert ? stateAlert : false, true);
                await adapter.setStateAsync(path + '.state.unknown', stateUnknown ? stateUnknown : false, true);
                await adapter.setStateAsync(path + '.geo.latitude', station.latitude ? station.latitude : 0, true);
                await adapter.setStateAsync(path + '.geo.longitude', station.longitude ? station.longitude : 0, true);
                await adapter.setStateAsync(path + '.geo.altitude', station.altitudeM ? station.altitudeM : 0, true);

                let height = 0;

                for (let o = 0; o < station.data.length; o++) {
                    let stationData = station.data[o];
                    if (stationData.type == 'height in cm') {
                        o = station.data.length;

                        await adapter.setStateAsync(path + '.height', { val: stationData.value ? stationData.value : 0, ack: true });
                        height = stationData.value;

                        let sourceDate = new Date(Date.parse(stationData.sourceDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, '$3-$2-$1$4'))).toUTCString();
                        await adapter.setStateAsync(path + '.sourceDate', sourceDate ? sourceDate : 'none', true);

                        let requestDate = new Date(Date.parse(stationData.requestDate.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/g, '$3-$2-$1$4'))).toUTCString();
                        await adapter.setStateAsync(path + '.requestDate', requestDate ? requestDate : 'none', true);
                    }
                }

                // created json
                let json = ({
                    "stationsname": station.stationName,
                    "region": station.region,
                    "country": station.country,
                    "water": station.water,
                    "height": height,
                    "trend": decodeTrend(station.trend, 'short'),
                    "warning": stateWarning,
                    "alert": stateAlert
                });
                allStationsJSON.push(json);

                await adapter.setStateAsync(path + '.json', { val: json ? JSON.stringify(json) : '', ack: true });

            }

            await adapter.setStateAsync('allStationsJSON', { val: allStationsJSON ? JSON.stringify(allStationsJSON) : '', ack: true });

            await adapter.setStateAsync('warning.hasWarning', warnings.length > 0 ? true : false, true);
            await adapter.setStateAsync('warning.statepathes', warnings ? JSON.stringify(warnings) : '', true);
            await adapter.setStateAsync('alert.hasAlert', alerts.length > 0 ? true : false, true);
            await adapter.setStateAsync('alert.statepathes', alerts ? JSON.stringify(alerts) : '', true);

            let lastRun = new Date().toUTCString();

            lastRun && await adapter.setStateAsync('lastRun', lastRun, true);
            adapter.log.debug('Pegelalarm request done');
        } else {
            deleteOldStates = false;
            adapter.log.error('Wrong JSON returned');
            adapter.log.error('Pegelalarm API cannot be reached at the moment');
        }
    } else {
        deleteOldStates = false;
        adapter.log.error('Pegelalarm API cannot be reached at the moment');
    }
}

function createStations(path) {
    return new Promise((resolve) => {
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

function decodeTrend(code, type = '') {
    let text = 'Unknown water level';
    let shortText = 'unknown';

    switch (code) {
        case -10:
            text = 'Falling water level';
            shortText = 'falling';
            break;
        case 0:
            text = 'Constant water height';
            shortText = 'constant';
            break;
        case 10:
            text = 'Rising water level';
            shortText = 'rising';
            break;
        default:
            text = 'Unknown water level';
            shortText = 'unknown';
    }

    if (type.length && type == 'short') {
        return shortText;
    }

    return text;
}

function decodeSituation(code, type = '') {
    let text = 'Unknown water level';
    let group = 'unknown';

    switch (code) {
        case -10:
            text = 'Under or normal water level';
            group = 'normal';
            break;
        case 10:
            text = 'Normal or slightly elevated water level';
            group = 'normal';
            break;
        case 20:
            text = 'Increased water level';
            group = 'normal';
            break;
        case 30:
            text = 'The water level has reached the warning limit';
            group = 'warning';
            break;
        case 40:
            text = 'The water level causes a regional flood';
            group = 'alert';
            break;
        case 50:
            text = 'Water level causes a national flood';
            group = 'alert';
            break;
        default:
            text = 'Unknown situation';
            group = 'unknown';
    }

    if (type.length && type == 'group') {
        return group;
    }

    return text;
}

function stopAdapter() {
    setImmediate(() => {
        adapter.stop ? adapter.stop() : adapter.terminate();
    });
}

async function checkStation(currentStations) {
    return new Promise(async (resolve) => {
        adapter.log.debug('Check for deleting old states is started');

        if (deleteOldStates) {
            try {
                const _stationStateList = await adapter.getForeignObjectsAsync(adapter.namespace + '.stations.*', 'state');

                for (const i in _stationStateList) {
                    const resID = _stationStateList[i]._id;
                    const objectID = resID.split('.');
                    const resultID = objectID[3];

                    if (currentStations.indexOf(resultID) === -1) {
                        adapter.log.debug(`DELETE: ${resID}`);
                        await adapter.delObjectAsync(resID);
                    }
                }
            } catch (err) {
                adapter.log.error(err);
            }

            try {
                const _stationChannelList = await adapter.getForeignObjectsAsync(adapter.namespace + '.stations.*', 'channel');

                for (const i in _stationChannelList) {
                    const resID = _stationChannelList[i]._id;
                    const objectID = resID.split('.');
                    const resultID = objectID[3];

                    if (currentStations.indexOf(resultID) === -1) {
                        adapter.log.debug(`DELETE: ${resID}`);
                        await adapter.delObjectAsync(resID, { recursive: true });
                    }
                }
            } catch (err) {
                adapter.log.error(err);
            }
            resolve();
        } else {
            adapter.log.debug('Deleting old states is currently inactive');
            resolve();
        }
    });
}

function sleep(ms) {
    return new Promise(async (resolve) => {
        timerRequest = setTimeout(() => resolve(), ms);
    });
}

async function requestLoop(index) {
    let num = 0;
    if (adapter.config[`stationname${index}`] || adapter.config[`region${index}`] || adapter.config[`water${index}`]) {
        num = index + 1;
        adapter.log.debug(`Pegelalarm request for measuring station ${num} is started ...`);

        requestData(adapter.config[`stationname${index}`], adapter.config[`region${index}`], adapter.config[`water${index}`])
            .then(async () => {
                num = index + 1;
                adapter.log.debug(`Pegelalarm request for measuring station ${num} is finish ...`);
                if (index < 4) {
                    index++

                    await sleep(1000);
                    setImmediate(requestLoop, index);
                    return;
                } else {
                    adapter.log.debug('Pegelalarm Request is completed');
                    await checkStation(currentStations);
                    stopAdapter();
                }
            }).catch(err => {
                adapter.log.error(`Request is not completed: ${err}`);
                stopAdapter();
            });
    } else if (index < 4) {
        index++

        await sleep(1000);
        setImmediate(requestLoop, index);
        return;
    } else if (index === 4) {
        adapter.log.debug('Pegelalarm Request is completed');
        await checkStation(currentStations);
        stopAdapter();
    }
}

function main() {
    if (adapter.config.configurated !== 0) {
        requestLoop(0); // start request in Loop for Measuring stations 0-4
        timerStop = setTimeout(() => stopAdapter(), 360 * 1000); // Force Adapter stop
    } else {
        adapter.log.warn('Please configure the adapter first!');
        timerMain = setTimeout(() => stopAdapter(), 5000);
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
