const fs = require("fs");

/*
==================================================
IAN FLEMING INTERNATIONAL AIRPORT
Display name in our project: POT
Real airport data code: OCJ
Source: FlightStats
==================================================
*/

const AIRPORT = "OCJ";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/json"
};


/* ==================================================
   FETCH
   ================================================== */

async function fetchPage(url) {

  const response = await fetch(url, {
    headers: HEADERS
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}`
    );
  }

  return await response.text();
}


/* ==================================================
   JAMAICA DATE
   ================================================== */

function getJamaicaDate() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "America/Jamaica",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(new Date());

  const year =
    parts.find(p => p.type === "year").value;

  const month =
    parts.find(p => p.type === "month").value;

  const day =
    parts.find(p => p.type === "day").value;

  return {
    year,
    month,
    day
  };
}


/* ==================================================
   FLIGHTSTATS BOARD URL

   FlightStats allows a maximum 12-hour window,
   so we request:

   00:00 - 12:00
   12:00 - 24:00
   ================================================== */

function buildBoardUrl(
  type,
  date,
  startHour
) {

  return (
    `https://www.flightstats.com/v2/api-next/flight-tracker/` +
    `${type}/${AIRPORT}/` +
    `${date.year}/${date.month}/${date.day}/` +
    `${startHour}?numHours=12`
  );
}


/* ==================================================
   FIND FLIGHT ARRAYS
   ================================================== */

function findFlightArrays(
  value,
  arrays = []
) {

  if (!value) return arrays;

  if (Array.isArray(value)) {

    if (
      value.some(
        item =>
          item &&
          typeof item === "object" &&
          (
            item.flightId ||
            item.flightNumber ||
            item.carrier
          )
      )
    ) {
      arrays.push(value);
    }

    for (const item of value) {
      findFlightArrays(
        item,
        arrays
      );
    }

    return arrays;
  }


  if (typeof value === "object") {

    for (const child of Object.values(value)) {
      findFlightArrays(
        child,
        arrays
      );
    }
  }

  return arrays;
}


/* ==================================================
   EXTRACT BOARD FLIGHTS
   ================================================== */

function extractBoardFlights(text) {

  let data;

  try {
    data = JSON.parse(text);
  }
  catch {
    return [];
  }

  const arrays =
    findFlightArrays(data);

  if (!arrays.length) {
    return [];
  }

  return arrays
    .sort(
      (a, b) =>
        b.length - a.length
    )[0];
}


/* ==================================================
   BASIC FLIGHT INFORMATION
   ================================================== */

function getCarrierCode(flight) {

  return (
    flight?.carrier?.fs ||
    flight?.carrierFsCode ||
    flight?.carrierCode ||
    flight?.airlineCode ||
    ""
  );
}


function getCarrierName(flight) {

  return (
    flight?.carrier?.name ||
    flight?.carrierName ||
    flight?.airlineName ||
    ""
  );
}


function getFlightNumber(flight) {

  return String(
    flight?.flightNumber ||
    flight?.flight?.flightNumber ||
    ""
  );
}


function getFlightUrl(flight) {

  return (
    flight?.url ||
    flight?.flightUrl ||
    flight?.detailsUrl ||
    ""
  );
}


/* ==================================================
   CODESHARE CHECK
   ================================================== */

function isCodeshare(flight) {

  return Boolean(
    flight?.isCodeshare ||
    flight?.codeshare ||
    flight?.operatedBy ||
    flight?.operatedByCarrier
  );
}


/* ==================================================
   DUPLICATE KEY
   ================================================== */

function flightKey(flight) {

  const code =
    getCarrierCode(flight);

  const number =
    getFlightNumber(flight);

  const id =
    flight?.flightId || "";

  if (id) {
    return String(id);
  }

  return `${code}|${number}`;
}


function removeDuplicates(flights) {

  const seen =
    new Set();

  const output = [];

  for (const flight of flights) {

    const key =
      flightKey(flight);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(flight);
  }

  return output;
}


/* ==================================================
   FLIGHT DETAIL PAGE
   ================================================== */

function extractNextData(html) {

  const match =
    html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  }
  catch {
    return null;
  }
}


function getDetailFlight(nextData) {

  return (
    nextData
      ?.props
      ?.initialState
      ?.flightTracker
      ?.flight ||
    null
  );
}


/* ==================================================
   TIME FORMATTING
   ================================================== */

function formatTime(value) {

  if (!value) return "";

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "America/Jamaica",

      hour:
        "numeric",

      minute:
        "2-digit",

      hour12:
        true
    }
  )
    .format(date)
    .replace(" ", "");
}


/* ==================================================
   SEARCH OBJECT FOR TIME VALUES
   ================================================== */

function searchTime(
  object,
  keywords
) {

  if (
    !object ||
    typeof object !== "object"
  ) {
    return "";
  }

  for (
    const [key, value]
    of Object.entries(object)
  ) {

    const lower =
      key.toLowerCase();

    if (
      keywords.some(
        word =>
          lower.includes(word)
      )
    ) {

      if (
        typeof value === "string" &&
        value.includes("T")
      ) {

        const formatted =
          formatTime(value);

        if (formatted) {
          return formatted;
        }
      }
    }
  }


  for (
    const value
    of Object.values(object)
  ) {

    if (
      value &&
      typeof value === "object"
    ) {

      const found =
        searchTime(
          value,
          keywords
        );

      if (found) {
        return found;
      }
    }
  }

  return "";
}


/* ==================================================
   SCHEDULED TIME
   ================================================== */

function getScheduledTime(
  detail,
  board
) {

  const detailTime =
    searchTime(
      detail,
      [
        "scheduled"
      ]
    );

  if (detailTime) {
    return detailTime;
  }


  return (
    board?.departureTime ||
    board?.arrivalTime ||
    board?.scheduledTime ||
    board?.scheduled ||
    ""
  );
}


/* ==================================================
   LIVE TIME
   ================================================== */

function getLiveTimeInfo(detail) {

  const actual =
    searchTime(
      detail,
      [
        "actual"
      ]
    );

  if (actual) {

    return {
      actualTime:
        actual,

      estimatedTime:
        "",

      updatedTime:
        actual,

      timeType:
        "Actual",

      displayTime:
        actual
    };
  }


  const estimated =
    searchTime(
      detail,
      [
        "estimated"
      ]
    );

  if (estimated) {

    return {
      actualTime:
        "",

      estimatedTime:
        estimated,

      updatedTime:
        estimated,

      timeType:
        "Estimated",

      displayTime:
        estimated
    };
  }


  return {
    actualTime:
      "",

    estimatedTime:
      "",

    updatedTime:
      "",

    timeType:
      "",

    displayTime:
      ""
  };
}


/* ==================================================
   STATUS
   ================================================== */

function getStatus(
  detail,
  board
) {

  return (
    detail?.status?.name ||
    detail?.status?.description ||
    detail?.status ||
    board?.status?.name ||
    board?.status ||
    "Scheduled"
  );
}


/* ==================================================
   AIRPORT INFORMATION
   ================================================== */

function getOtherAirport(
  detail,
  board,
  type
) {

  let airport = null;

  if (type === "arrivals") {

    airport =
      detail?.departureAirport ||
      detail?.departure ||
      board?.departureAirport ||
      board?.departure;
  }
  else {

    airport =
      detail?.arrivalAirport ||
      detail?.arrival ||
      board?.arrivalAirport ||
      board?.arrival;
  }


  const airportCode =
    airport?.fs ||
    airport?.iata ||
    airport?.iataCode ||
    airport?.code ||
    "";


  const city =
    airport?.city ||
    airport?.cityName ||
    airport?.name ||
    "";


  return {
    airportCode,
    city
  };
}


/* ==================================================
   GATE / TERMINAL / BAGGAGE
   ================================================== */

function findTextValue(
  object,
  keywords
) {

  if (
    !object ||
    typeof object !== "object"
  ) {
    return "";
  }


  for (
    const [key, value]
    of Object.entries(object)
  ) {

    const lower =
      key.toLowerCase();

    if (
      keywords.some(
        word =>
          lower.includes(word)
      )
    ) {

      if (
        typeof value === "string" ||
        typeof value === "number"
      ) {

        const text =
          String(value).trim();

        if (
          text &&
          text.length < 30
        ) {
          return text;
        }
      }
    }
  }


  for (
    const value
    of Object.values(object)
  ) {

    if (
      value &&
      typeof value === "object"
    ) {

      const found =
        findTextValue(
          value,
          keywords
        );

      if (found) {
        return found;
      }
    }
  }

  return "";
}


/* ==================================================
   NORMALIZE ONE FLIGHT
   ================================================== */

function normalizeFlight(
  board,
  detail,
  type
) {

  const airlineCode =
    getCarrierCode(detail) ||
    getCarrierCode(board);


  const airline =
    getCarrierName(detail) ||
    getCarrierName(board) ||
    airlineCode;


  const flightNumber =
    getFlightNumber(detail) ||
    getFlightNumber(board);


  const otherAirport =
    getOtherAirport(
      detail,
      board,
      type
    );


  const scheduledTime =
    getScheduledTime(
      detail,
      board
    );


  const live =
    getLiveTimeInfo(detail);


  const status =
    getStatus(
      detail,
      board
    );


  const gate =
    findTextValue(
      detail,
      [
        "gate"
      ]
    );


  const terminal =
    findTextValue(
      detail,
      [
        "terminal"
      ]
    );


  const baggage =
    findTextValue(
      detail,
      [
        "baggage",
        "carousel"
      ]
    );


  return {

    airlineCode,

    airline,

    flightNumber,

    flight:
      `${airlineCode}${flightNumber}`,

    airportCode:
      otherAirport.airportCode,

    city:
      otherAirport.city,

    scheduledTime,

    estimatedTime:
      live.estimatedTime,

    actualTime:
      live.actualTime,

    updatedTime:
      live.updatedTime,

    timeType:
      live.timeType,

    displayTime:
      live.displayTime,

    status,

    gate,

    terminal,

    baggage,

    flightId:
      detail?.flightId ||
      board?.flightId ||
      "",

    source:
      "FlightStats"
  };
}


/* ==================================================
   DETAIL URL
   ================================================== */

function buildDetailUrl(
  board,
  date
) {

  const supplied =
    getFlightUrl(board);

  if (supplied) {

    if (
      supplied.startsWith("http")
    ) {
      return supplied;
    }

    return (
      "https://www.flightstats.com" +
      supplied
    );
  }


  const code =
    getCarrierCode(board);

  const number =
    getFlightNumber(board);


  if (!code || !number) {
    return "";
  }


  return (
    `https://www.flightstats.com/v2/flight-tracker/` +
    `${code}/${number}` +
    `?year=${date.year}` +
    `&month=${Number(date.month)}` +
    `&date=${Number(date.day)}`
  );
}


/* ==================================================
   PROCESS FLIGHTS
   ================================================== */

async function processFlights(
  flights,
  type,
  date
) {

  const results = [];

  for (const board of flights) {

    const code =
      getCarrierCode(board);

    const number =
      getFlightNumber(board);

    console.log(
      `Getting details: ${code}${number}`
    );


    let detail = null;

    const detailUrl =
      buildDetailUrl(
        board,
        date
      );


    if (detailUrl) {

      try {

        const html =
          await fetchPage(
            detailUrl
          );

        const nextData =
          extractNextData(
            html
          );

        detail =
          getDetailFlight(
            nextData
          );

      }
      catch (error) {

        console.log(
          `Detail unavailable for ${code}${number}`
        );
      }
    }


    results.push(
      normalizeFlight(
        board,
        detail,
        type
      )
    );


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          500
        )
    );
  }

  return results;
}


/* ==================================================
   SORT BY SCHEDULED TIME
   ================================================== */

function timeToMinutes(time) {

  if (!time) {
    return 9999;
  }

  const match =
    String(time)
      .match(
        /^(\d{1,2}):(\d{2})(AM|PM)$/i
      );

  if (!match) {
    return 9999;
  }


  let hour =
    Number(match[1]);

  const minute =
    Number(match[2]);

  const ampm =
    match[3]
      .toUpperCase();


  if (hour === 12) {
    hour = 0;
  }

  if (ampm === "PM") {
    hour += 12;
  }


  return (
    hour * 60 +
    minute
  );
}


/* ==================================================
   FETCH FULL DAY
   ================================================== */

async function fetchFullDay(
  type,
  label,
  date
) {

  console.log(
    `Fetching OCJ ${label} 00:00-12:00...`
  );

  const morningText =
    await fetchPage(
      buildBoardUrl(
        type,
        date,
        0
      )
    );


  console.log(
    `Fetching OCJ ${label} 12:00-24:00...`
  );

  const afternoonText =
    await fetchPage(
      buildBoardUrl(
        type,
        date,
        12
      )
    );


  const morning =
    extractBoardFlights(
      morningText
    );

  const afternoon =
    extractBoardFlights(
      afternoonText
    );


  const combined = [
    ...morning,
    ...afternoon
  ];


  console.log(
    `${label}: ${combined.length} raw full-day records found`
  );


  const unique =
    removeDuplicates(
      combined
    );


  console.log(
    `${label}: ${unique.length} after duplicate removal`
  );


  const operating =
    unique.filter(
      flight =>
        !isCodeshare(flight)
    );


  console.log(
    `${label}: ${operating.length} operating flights after codeshare removal`
  );


  return operating;
}


/* ==================================================
   MAIN
   ================================================== */

async function main() {

  console.log(
    "OCJ / POT FULL-DAY FlightStats updater starting..."
  );

  console.log(
    new Date().toISOString()
  );


  const date =
    getJamaicaDate();


  /* ARRIVALS */

  const arrivalBoards =
    await fetchFullDay(
      "arr",
      "arrivals",
      date
    );


  const arrivals =
    await processFlights(
      arrivalBoards,
      "arrivals",
      date
    );


  arrivals.sort(
    (a, b) =>
      timeToMinutes(
        a.scheduledTime
      ) -
      timeToMinutes(
        b.scheduledTime
      )
  );


  /* DEPARTURES */

  const departureBoards =
    await fetchFullDay(
      "dep",
      "departures",
      date
    );


  const departures =
    await processFlights(
      departureBoards,
      "departures",
      date
    );


  departures.sort(
    (a, b) =>
      timeToMinutes(
        a.scheduledTime
      ) -
      timeToMinutes(
        b.scheduledTime
      )
  );


  const updated =
    new Date().toISOString();


  /* POT ARRIVALS JSON */

  const arrivalsOutput = {

    airport:
      "OCJ",

    displayAirport:
      "POT",

    airportName:
      "Ian Fleming International Airport",

    location:
      "Ocho Rios, Jamaica",

    type:
      "arrivals",

    source:
      "FlightStats",

    updated,

    flights:
      arrivals
  };


  fs.writeFileSync(
    "pot-arrivals.json",
    JSON.stringify(
      arrivalsOutput,
      null,
      2
    )
  );


  /* POT DEPARTURES JSON */

  const departuresOutput = {

    airport:
      "OCJ",

    displayAirport:
      "POT",

    airportName:
      "Ian Fleming International Airport",

    location:
      "Ocho Rios, Jamaica",

    type:
      "departures",

    source:
      "FlightStats",

    updated,

    flights:
      departures
  };


  fs.writeFileSync(
    "pot-departures.json",
    JSON.stringify(
      departuresOutput,
      null,
      2
    )
  );


  console.log(
    `FULL-DAY OCJ ARRIVALS: ${arrivals.length}`
  );

  console.log(
    `FULL-DAY OCJ DEPARTURES: ${departures.length}`
  );

  console.log(
    `Updated: ${updated}`
  );

  console.log(
    "OCJ / POT FULL-DAY UPDATE COMPLETE"
  );
}


main().catch(error => {

  console.error(
    "OCJ / POT UPDATE FAILED:"
  );

  console.error(error);

  process.exit(1);
});
