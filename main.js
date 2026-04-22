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
// | 40   | The water level causes a regional flood           | alert   | red    |
// -------------------------------------------------------------------------------
// | 50   | Water level causes a national flood               | alert   | red    |
// -------------------------------------------------------------------------------
// | 100  | Unknown situation                                 | unknown | blue   |
// -------------------------------------------------------------------------------

'use strict';

const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();
const axios = require('axios');

let adapter;

let currentStations = [];
let allStationsJSON = [];
let deleteOldStates = true;

let timerMain, timerStop, ioBrokerVersion;

/**
 * Starts the adapter instance.
 *
 * @param {Partial<ioBroker.AdapterOptions>} [options] - Adapter options
 */
function startAdapter(options) {
    options = options || {};
    Object.assign(options, { name: adapterName, useFormatDate: true });

    adapter = new utils.Adapter(options);

    adapter.on('ready', main);

    adapter.on('unload', (callback) => {
        try {
            adapter.log.debug('cleaned everything up...');
            timerMain && clearTimeout(timerMain);
            timerStop && clearTimeout(timerStop);
            callback();
        } catch {
            callback();
        }
    });

    return adapter;
}

/**
 * Parses and normalizes a date string from DD.MM.YYYY HH:MM:SS format to UTC string.
 *
 * @param {string} dateStr - Date string in DD.MM.YYYY format
 * @returns {string} UTC date string
 */
function parseStationDate(dateStr) {
    const normalized = dateStr.replace(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})(.*)$/, '$3-$2-$1$4');
    return new Date(Date.parse(normalized)).toUTCString();
}

/**
 * Sanitizes a station name for use as an ioBroker state path segment.
 * Transliterates umlauts and special characters before stripping remaining invalid characters.
 *
 * @param {string} name - Raw station name from the API
 * @returns {string} Sanitized station name safe for use in state paths
 */
function sanitizeStationName(name) {
    const umlautMap = {
        ä: 'ae', ö: 'oe', ü: 'ue',
        Ä: 'Ae', Ö: 'Oe', Ü: 'Ue',
        ß: 'ss',
        à: 'a', á: 'a', â: 'a', ã: 'a',
        è: 'e', é: 'e', ê: 'e', ë: 'e',
        ì: 'i', í: 'i', î: 'i', ï: 'i',
        ò: 'o', ó: 'o', ô: 'o', õ: 'o',
        ù: 'u', ú: 'u', û: 'u',
        ý: 'y', ÿ: 'y',
        ñ: 'n', ç: 'c',
    };
    return name
        .replace(/[äöüÄÖÜßàáâãèéêëìíîïòóôõùúûýÿñç]/g, ch => umlautMap[ch] ?? ch)
        .toLowerCase()
        .replace(/\s/g, '_')
        .replace(/[^a-z0-9_\\-]/g, '');
}

/**
 * Requests data from the Pegelalarm API and writes results to ioBroker states.
 *
 * @param {string} _stationname - Name of the measuring station (empty string = no filter)
 * @param {string} _region - Region filter (empty string = no filter)
 * @param {string} _water - Water body filter (empty string = no filter)
 */
async function requestData(_stationname, _region, _water) {
    let dataUrl = `https://api.pegelalarm.at/api/station/1.0/list?countryCode=${adapter.config.country}`;

    if (_region.trim().length) dataUrl += `&qRegion=${_region}`;
    if (_water.trim().length) dataUrl += `&qWater=${_water}`;
    if (_stationname.trim().length) dataUrl += `&qStationName=${_stationname}`;

    const url = encodeURI(dataUrl);
    adapter.log.debug(url);

    let data;
    try {
        const response = await axios({
            method: 'get',
            timeout: 5000,
            url,
            responseType: 'json',
            validateStatus: () => true,
            headers: {
                'User-Agent': `ioBroker v${ioBrokerVersion}`,
                'X-App-Name': `simatec/ioBroker.pegelalarm v${adapter.version}`,
                'X-Contact-Email': require('./package.json').author.email,
            },
        });

        if (response?.data && response?.status === 200) {
            adapter.log.debug(`Pegelalarm API response received ... Status: ${response.status}`);
            data = response.data;
        } else {
            deleteOldStates = false;
            adapter.log.error(`Unexpected API response. Status: ${response?.status ?? 'unknown'}`);
            adapter.log.error('Pegelalarm API cannot be reached at the moment');
            return;
        }
    } catch (err) {
        deleteOldStates = false;
        adapter.log.error(`Pegelalarm API request failed: ${err.message}`);
        adapter.log.error('Pegelalarm API cannot be reached at the moment');
        return;
    }

    // Filter to exact station name match if multiple results are returned
    if (_stationname !== '' && data?.payload?.stations?.length > 1) {
        data.payload.stations = data.payload.stations.filter(s => s.stationName === _stationname);
    }

    if (!data?.payload?.stations) {
        deleteOldStates = false;
        adapter.log.error('Wrong JSON returned');
        adapter.log.error('Pegelalarm API cannot be reached at the moment');
        return;
    }

    const warnings = [];
    const alerts = [];

    for (const station of data.payload.stations) {
        const sanitizedName = sanitizeStationName(station.stationName);
        const path = `stations.${sanitizedName}`;
        currentStations.push(sanitizedName);

        await createStations(path);

        await adapter.setStateAsync(`${path}.name`, station.stationName ?? 'none', true);
        await adapter.setStateAsync(`${path}.country`, station.country ?? 'none', true);
        await adapter.setStateAsync(`${path}.water`, station.water ?? 'none', true);
        await adapter.setStateAsync(`${path}.region`, station.region ?? 'none', true);
        await adapter.setStateAsync(`${path}.situation.text`, decodeSituation(station.situation), true);
        await adapter.setStateAsync(`${path}.situation.group`, decodeSituation(station.situation, 'group'), true);
        await adapter.setStateAsync(`${path}.situation.code`, station.situation ?? 0, true);
        await adapter.setStateAsync(`${path}.trend.text`, decodeTrend(station.trend), true);
        await adapter.setStateAsync(`${path}.trend.short`, decodeTrend(station.trend, 'short'), true);
        await adapter.setStateAsync(`${path}.trend.code`, station.trend ?? 0, true);

        const situationGroup = decodeSituation(station.situation, 'group');
        const stateNormal = situationGroup === 'normal';
        const stateWarning = situationGroup === 'warning';
        const stateAlert = situationGroup === 'alert';
        const stateUnknown = situationGroup === 'unknown';

        if (stateWarning) warnings.push(path);
        if (stateAlert) alerts.push(path);

        await adapter.setStateAsync(`${path}.state.normal`, stateNormal, true);
        await adapter.setStateAsync(`${path}.state.warning`, stateWarning, true);
        await adapter.setStateAsync(`${path}.state.alert`, stateAlert, true);
        await adapter.setStateAsync(`${path}.state.unknown`, stateUnknown, true);
        await adapter.setStateAsync(`${path}.geo.latitude`, station.latitude ?? 0, true);
        await adapter.setStateAsync(`${path}.geo.longitude`, station.longitude ?? 0, true);
        await adapter.setStateAsync(`${path}.geo.altitude`, station.altitudeM ?? 0, true);

        let height = 0;
        const heightData = station.data.find(d => d.type === 'height in cm');
        if (heightData) {
            height = heightData.value ?? 0;
            await adapter.setStateAsync(`${path}.height`, { val: height, ack: true });
            await adapter.setStateAsync(`${path}.sourceDate`, parseStationDate(heightData.sourceDate), true);
            await adapter.setStateAsync(`${path}.requestDate`, parseStationDate(heightData.requestDate), true);
        }

        const json = {
            stationsname: station.stationName,
            region: station.region,
            country: station.country,
            water: station.water,
            height,
            trend: decodeTrend(station.trend, 'short'),
            warning: stateWarning,
            alert: stateAlert,
        };
        allStationsJSON.push(json);

        await adapter.setStateAsync(`${path}.json`, { val: JSON.stringify(json), ack: true });
    }

    await adapter.setStateAsync('allStationsJSON', { val: JSON.stringify(allStationsJSON), ack: true });
    await adapter.setStateAsync('warning.hasWarning', warnings.length > 0, true);
    await adapter.setStateAsync('warning.statepathes', JSON.stringify(warnings), true);
    await adapter.setStateAsync('alert.hasAlert', alerts.length > 0, true);
    await adapter.setStateAsync('alert.statepathes', JSON.stringify(alerts), true);
    await adapter.setStateAsync('lastRun', new Date().toUTCString(), true);

    adapter.log.debug('Pegelalarm request done');
}

/**
 * Creates all required ioBroker objects (channels + states) for a station path.
 *
 * @param {string} path - ioBroker state path for the station (e.g. 'stations.musterstation')
 */
async function createStations(path) {
    const statesString = [
        'country', 'name', 'region', 'water', 'json',
        'situation.group', 'situation.text', 'trend.short', 'trend.text',
    ];
    const statesNumber = [
        'height', 'geo.altitude', 'geo.latitude', 'geo.longitude',
        'situation.code', 'trend.code',
    ];
    const statesDate = ['requestDate', 'sourceDate'];
    const statesBoolean = ['state.alert', 'state.normal', 'state.unknown', 'state.warning'];
    const channels = ['state', 'geo', 'situation', 'trend'];

    adapter.setObjectNotExists('stations', {
        type: 'channel',
        common: { name: 'stations' },
        native: {},
    });

    for (const ch of channels) {
        adapter.setObjectNotExists(`${path}.${ch}`, {
            type: 'channel',
            common: { name: ch },
            native: {},
        });
    }
    for (const key of statesString) {
        adapter.setObjectNotExists(`${path}.${key}`, {
            type: 'state',
            common: { name: key, type: 'string', role: key === 'json' ? 'json' : 'text', read: true, write: false },
            native: {},
        });
    }
    for (const key of statesNumber) {
        adapter.setObjectNotExists(`${path}.${key}`, {
            type: 'state',
            common: { name: key, type: 'number', role: 'value', unit: key === 'height' ? 'cm' : '', read: true, write: false },
            native: {},
        });
    }
    for (const key of statesDate) {
        adapter.setObjectNotExists(`${path}.${key}`, {
            type: 'state',
            common: { name: key, type: 'string', role: 'date', read: true, write: false },
            native: {},
        });
    }
    for (const key of statesBoolean) {
        adapter.setObjectNotExists(`${path}.${key}`, {
            type: 'state',
            common: { name: key, type: 'boolean', role: 'indicator', read: true, write: false },
            native: {},
        });
    }

    // Allow object creation calls to settle before writing states
    await adapter.delay(500);
}

/**
 * Decodes a trend code into a human-readable string.
 *
 * @param {number} code - Trend code from the Pegelalarm API (-10, 0, 10)
 * @param {'short'|''} [type] - Return type: 'short' for short text, '' for full text
 * @returns {string} Human-readable trend description
 */
function decodeTrend(code, type = '') {
    const trends = {
        '-10': { text: 'Falling water level', short: 'falling' },
        0: { text: 'Constant water height', short: 'constant' },
        10: { text: 'Rising water level', short: 'rising' },
    };
    const entry = trends[String(code)];
    if (!entry) return type === 'short' ? 'unknown' : 'Unknown water level';
    return type === 'short' ? entry.short : entry.text;
}

/**
 * Decodes a situation code into a human-readable string or group name.
 *
 * @param {number} code - Situation code from the Pegelalarm API (-10, 10, 20, 30, 40, 50)
 * @param {'group'|''} [type] - Return type: 'group' for group name, '' for full text
 * @returns {string} Human-readable situation description or group name
 */
function decodeSituation(code, type = '') {
    const situations = {
        '-10': { text: 'Under or normal water level', group: 'normal' },
        10: { text: 'Normal or slightly elevated water level', group: 'normal' },
        20: { text: 'Increased water level', group: 'normal' },
        30: { text: 'The water level has reached the warning limit', group: 'warning' },
        40: { text: 'The water level causes a regional flood', group: 'alert' },
        50: { text: 'Water level causes a national flood', group: 'alert' },
    };
    const entry = situations[String(code)];
    if (!entry) return type === 'group' ? 'unknown' : 'Unknown situation';
    return type === 'group' ? entry.group : entry.text;
}

/**
 * Stops the adapter instance gracefully.
 */
function stopAdapter() {
    setImmediate(() => {
        adapter.stop ? adapter.stop() : adapter.terminate();
    });
}

/**
 * Deletes ioBroker objects for stations that are no longer returned by the API.
 *
 * @param {string[]} activeStations - List of currently active sanitized station names
 */
async function checkStation(activeStations) {
    if (!deleteOldStates) {
        adapter.log.debug('Deleting old states is currently inactive');
        return;
    }

    adapter.log.debug('Check for deleting old states is started');

    try {
        const stateList = await adapter.getForeignObjectsAsync(`${adapter.namespace}.stations.*`, 'state');
        for (const id of Object.keys(stateList)) {
            const stationSegment = id.split('.')[3];
            if (!activeStations.includes(stationSegment)) {
                adapter.log.debug(`DELETE state: ${id}`);
                await adapter.delObjectAsync(id);
            }
        }
    } catch (err) {
        adapter.log.error(err);
    }

    try {
        const channelList = await adapter.getForeignObjectsAsync(`${adapter.namespace}.stations.*`, 'channel');
        for (const id of Object.keys(channelList)) {
            const stationSegment = id.split('.')[3];
            if (!activeStations.includes(stationSegment)) {
                adapter.log.debug(`DELETE channel: ${id}`);
                await adapter.delObjectAsync(id, { recursive: true });
            }
        }
    } catch (err) {
        adapter.log.error(err);
    }
}

/**
 * Iterates through the configured measuring stations (indices 0–4) and requests data for each.
 *
 * @param {number} index - Current station index (0–4)
 */
async function requestLoop(index) {
    const stationname = adapter.config[`stationname${index}`];
    const region = adapter.config[`region${index}`];
    const water = adapter.config[`water${index}`];

    if (stationname || region || water) {
        adapter.log.debug(`Pegelalarm request for measuring station ${index + 1} is started ...`);
        try {
            await requestData(stationname, region, water);
            adapter.log.debug(`Pegelalarm request for measuring station ${index + 1} finished`);
        } catch (err) {
            adapter.log.error(`Request failed for station ${index + 1}: ${err}`);
            stopAdapter();
            return;
        }
    }

    if (index < 4) {
        await adapter.delay(5000);
        return requestLoop(index + 1);
    }

    adapter.log.debug('Pegelalarm Request is completed');
    await checkStation(currentStations);
    stopAdapter();
}

/**
 * Main entry point called when the adapter is ready.
 */
async function main() {
    currentStations = [];
    allStationsJSON = [];

    if (adapter.config.configurated !== 0) {
        try {
            const hostObj = await adapter.getForeignObjectAsync(`system.host.${adapter.host}`);
            ioBrokerVersion = hostObj?.common?.installedVersion ?? 'unknown';
        } catch {
            adapter.log.warn('Could not read ioBroker host version');
            ioBrokerVersion = 'unknown';
        }

        requestLoop(0);
        timerStop = setTimeout(() => stopAdapter(), 360 * 1000); // Force stop after 6 min
    } else {
        adapter.log.warn('Please configure the adapter first!');
        timerMain = setTimeout(() => stopAdapter(), 5000);
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    startAdapter();
}