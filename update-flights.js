const fs = require("fs");

const ARRIVALS_URL =
  "https://www.mbjairport.com/flights?type=arrivals";

const DEPARTURES_URL =
  "https://www.mbjairport.com/flights?type=departures";


function clean(value = "") {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}


async function fetchPage(url, label) {

  console.log(
    `Fetching MBJ ${label} from official airport website...`
  );

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MBJ-Flight-Board/1.0)",
      "Accept":
        "text/html,application/xhtml+xml"
    }
  });

  console.log(
    `${label} HTTP status:`,
    response.status
  );

  if (!response.ok) {
    throw new Error(
      `MBJ ${label} returned HTTP ${response.status}`
    );
  }

  return await response.text();
}


/* ==================================================
   ARRIVALS
   PRESERVES YOUR CURRENT WORKING ARRIVALS PARSER
   ================================================== */

function parseArrivals(html) {

  const rows =
    html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  const flights = [];

  for (const row of rows) {

    const tdMatches =
      row.match(/<td[\s\S]*?<\/td>/gi);

    if (!tdMatches) continue;

    const cells =
      tdMatches.map(clean);

    if (cells.length < 5) continue;

    const airlineFlight =
      cells[0];

    const from =
      cells[1];

    const baggage =
      cells[2];

    /*
      MBJ arrival time cell may contain
      scheduled and updated/actual times.
    */

    const timeMatches =
      cells[3].match(
        /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi
      ) || [];

    const scheduledTime =
      timeMatches[0] ||
      cells[3] ||
      "";

    const actualTime =
      timeMatches[1] ||
      "";

    let status =
      cells[4] || "";

    /*
      A time by itself is not a textual status.
    */

    if (
      /^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(status)
    ) {
      status = "";
    }

    if (!airlineFlight || !from) {
      continue;
    }

    flights.push({
      airlineFlight,
      from,
      baggage,
      scheduledTime,
      actualTime,
      status
    });
  }

  return flights;
}


/* ==================================================
   DEPARTURES
   MBJ OFFICIAL COLUMN ORDER:

   0 Airline/Flight
   1 To
   2 Check-In Counters
   3 Gate
   4 Time
   5 Status
   ================================================== */

function parseDepartures(html) {

  const rows =
    html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  const flights = [];

  for (const row of rows) {

    const tdMatches =
      row.match(/<td[\s\S]*?<\/td>/gi);

    if (!tdMatches) continue;

    const cells =
      tdMatches.map(clean);

    /*
      Departures requires six columns.
    */

    if (cells.length < 6) continue;


    const airlineFlight =
      cells[0];

    const to =
      cells[1];

    const checkInCounters =
      cells[2] || "";

    const gate =
      cells[3] || "";

    const scheduledTime =
      cells[4] || "";

    const statusCell =
      cells[5] || "";


    /*
      MBJ may put an updated departure time
      inside the Status column.

      Example from the official page:

      Time:   12:38 PM
      Status: 1:37 PM + orange indicator

      We preserve that updated time.
    */

    const statusTimeMatches =
      statusCell.match(
        /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi
      ) || [];

    const actualTime =
      statusTimeMatches[0] || "";


    /*
      Determine status from MBJ's HTML indicator.

      The visible MBJ legend identifies:
      green  = On-Time
      orange = Delayed
      red    = Cancelled

      We inspect the original status TD
      rather than inventing a status based
      on the clock times.
    */

    const rawStatusTd =
      tdMatches[5] || "";

    let status = "";

    const rawLower =
      rawStatusTd.toLowerCase();


    if (
      rawLower.includes("cancel") ||
      rawLower.includes("#ed0029") ||
      rawLower.includes("rgb(237, 0, 41)")
    ) {
      status = "Cancelled";
    }

    else if (
      rawLower.includes("delay") ||
      rawLower.includes("#ff6600") ||
      rawLower.includes("#ff6") ||
      rawLower.includes("orange")
    ) {
      status = "Delayed";
    }

    else if (
      rawLower.includes("on-time") ||
      rawLower.includes("on time") ||
      rawLower.includes("#009b4") ||
      rawLower.includes("green")
    ) {
      status = "On-Time";
    }


    /*
      If MBJ supplies an updated time in
      the Status column but its HTML color
      cannot be identified, retain the
      updated time without inventing a label.
    */

    if (!airlineFlight || !to) {
      continue;
    }


    flights.push({
      airlineFlight,
      to,
      checkInCounters,
      gate,
      scheduledTime,
      actualTime,
      status
    });
  }

  return flights;
}


/* ==================================================
   MAIN
   ================================================== */

async function main() {

  /* --------------------
     ARRIVALS
     -------------------- */

  const arrivalsHtml =
    await fetchPage(
      ARRIVALS_URL,
      "arrivals"
    );

  const arrivals =
    parseArrivals(arrivalsHtml);

  console.log(
    "Arrival flights extracted:",
    arrivals.length
  );


  if (arrivals.length === 0) {

    fs.writeFileSync(
      "mbj-arrivals-debug.html",
      arrivalsHtml
    );

    throw new Error(
      "No MBJ arrivals were extracted. Existing flight data was left untouched."
    );
  }


  /* --------------------
     DEPARTURES
     -------------------- */

  const departuresHtml =
    await fetchPage(
      DEPARTURES_URL,
      "departures"
    );

  const departures =
    parseDepartures(departuresHtml);

  console.log(
    "Departure flights extracted:",
    departures.length
  );


  if (departures.length === 0) {

    fs.writeFileSync(
      "mbj-departures-debug.html",
      departuresHtml
    );

    throw new Error(
      "No MBJ departures were extracted. Existing departure data was left untouched."
    );
  }


  const updated =
    new Date().toISOString();


  /* --------------------
     WRITE ARRIVALS
     -------------------- */

  const arrivalsOutput = {

    airport:
      "MBJ",

    airportName:
      "Sangster International Airport",

    location:
      "Montego Bay, Jamaica",

    type:
      "arrivals",

    source:
      "Official MBJ Airport website",

    sourceUrl:
      ARRIVALS_URL,

    updated,

    flights:
      arrivals
  };


  fs.writeFileSync(
    "flights.json",
    JSON.stringify(
      arrivalsOutput,
      null,
      2
    )
  );


  /* --------------------
     WRITE DEPARTURES
     -------------------- */

  const departuresOutput = {

    airport:
      "MBJ",

    airportName:
      "Sangster International Airport",

    location:
      "Montego Bay, Jamaica",

    type:
      "departures",

    source:
      "Official MBJ Airport website",

    sourceUrl:
      DEPARTURES_URL,

    updated,

    flights:
      departures
  };


  fs.writeFileSync(
    "departures.json",
    JSON.stringify(
      departuresOutput,
      null,
      2
    )
  );


  /* --------------------
     LAST UPDATED
     -------------------- */

  fs.writeFileSync(
    "last_updated.txt",
    updated
  );


  console.log(
    "SUCCESS: MBJ arrivals and departures updated."
  );
}


main().catch(error => {

  console.error(
    "MBJ UPDATE FAILED:"
  );

  console.error(error);

  process.exit(1);

});
