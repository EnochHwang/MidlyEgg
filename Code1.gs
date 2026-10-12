// One spreadsheet per standalone Apps Script project.
// The ID is saved automatically on first initialization.
const SPREADSHEET_ID_PROPERTY =
  "SPREADSHEET_ID";

const ITEMS_SHEET =
  "Items";

const TRANSACTIONS_SHEET =
  "Transactions";

const TRANSACTION_ITEMS_SHEET =
  "TransactionItems";


/* =========================================================
   SETUP
   ========================================================= */

function getPOSSpreadsheet() {

  const properties =
    PropertiesService.getScriptProperties();

  const spreadsheetId =
    properties.getProperty(
      SPREADSHEET_ID_PROPERTY
    );

  if (spreadsheetId) {
    // Do not silently replace an existing database.
    return SpreadsheetApp.openById(
      spreadsheetId
    );
  }

  const spreadsheet =
    SpreadsheetApp.create(
      "MidlyEgg POS"
    );

  // Initialize all three worksheets before saving the ID.
  initializePOSSheets(spreadsheet);

  // Remove the default blank worksheet.
  const defaultSheet =
    spreadsheet.getSheetByName("Sheet1");

  if (defaultSheet) {
    spreadsheet.deleteSheet(defaultSheet);
  }

  properties.setProperty(
    SPREADSHEET_ID_PROPERTY,
    spreadsheet.getId()
  );

  return spreadsheet;
}

function setupPOS() {
  initializePOSSheets(
    getPOSSpreadsheet()
  );
}

function initializePOSSheets(spreadsheet) {

  createSheet(
    spreadsheet,
    "Items",
    [
      "ItemID",
      "Category",
      "ItemName",
      "UnitPrice",
      "Active",
      "Sort",
      "Inventory"
    ]
  );


  createSheet(
    spreadsheet,
    "Transactions",
    [
      "TransactionID",
      "PaymentType",
      "Total"
    ]
  );


  createSheet(
    spreadsheet,
    "TransactionItems",
    [
      "TransactionID",
      "ItemID",
      "ItemName",
      "Quantity",
      "UnitPrice",
      "PaymentType"
    ]
  );
}


function createSheet(
  spreadsheet,
  name,
  headers
) {

  let sheet =
    spreadsheet.getSheetByName(
      name
    );


  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        name
      );
  }


  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([
      headers
    ]);


  sheet.setFrozenRows(1);
}


/* =========================================================
   API
   ========================================================= */

function doGet() {

  return jsonResponse({
    ok: true,
    app: "MidlyEgg POS API"
  });
}

function doPost(e) {

  try {

    const request =
      JSON.parse(
        e.postData.contents || "{}"
      );


    switch (request.action) {

      case "getItems":

        return jsonResponse({
          ok: true,
          items: getItems()
        });

      case "replaceItems":

        replaceItems(
          request.items || []
        );

        return jsonResponse({
          ok: true
        });


      case "archiveTransactions":

        const archivedTransactionIds =
          archiveTransactions(
            request.transactions || [],
            request.transactionItems || []
          );

        return jsonResponse({
          ok: true,
          archivedTransactionIds
        });


      case "getTransactions":

        const history =
          getTransactions(
            request.dateFrom || "",
            request.dateTo || ""
          );

        return jsonResponse({
          ok: true,

          transactions:
            history.transactions,

          transactionItems:
            history.transactionItems,

          latestHistoricalDate:
            history.latestHistoricalDate
        });

      case "getSummary":

        return jsonResponse({
          ok: true,

          summary:
            getSummary(
              request.dateFrom || "",
              request.dateTo || ""
            )
        });

      case "deleteTransactions":

        return jsonResponse({
          ok: true,

          deletedTransactionIds:
            deleteTransactions(
              request.transactionIds || []
            )
        });

      default:
      
        throw new Error(
          "Unknown action: " +
          request.action
        );
    }


  } catch (error) {

    return jsonResponse({
      ok: false,
      error:
        String(
          error.message ||
          error
        )
    });
  }
}


/* =========================================================
   ITEMS
   ========================================================= */

function getItems() {

  const spreadsheet =
    getPOSSpreadsheet();


  const sheet =
    spreadsheet.getSheetByName(
      ITEMS_SHEET
    );


  if (!sheet) {

    throw new Error(
      'Missing sheet "Items".'
    );
  }


  const lastRow =
    sheet.getLastRow();


  if (lastRow <= 1) {
    return [];
  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        7
      )
      .getValues();


  return rows
    .filter(
      (row) =>
        row[0] !== ""
    )
    .map(
      (row) => ({
        itemId:
          Number(row[0]),

        category:
          String(row[1] || ""),

        itemName:
          String(row[2] || ""),

        unitPrice:
          Number(row[3]) || 0,

        active:
          row[4] === true ||
          String(row[4])
            .toLowerCase() ===
            "true",

        sort:
          Number(row[5]) || 0,

        inventory:
          Number(row[6]) || 0
      })
    );
}

function replaceItems(items) {

  const sheet =
    getPOSSpreadsheet()
      .getSheetByName(
        ITEMS_SHEET
      );


  if (!sheet) {

    throw new Error(
      'Missing sheet "Items".'
    );
  }


  const lastRow =
    sheet.getLastRow();


  if (lastRow > 1) {

    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        7
      )
      .clearContent();
  }


  if (!items.length) {
    return;
  }


  const rows =
    items.map(
      (item) => [
        Number(item.itemId),
        String(item.category || ""),
        String(item.itemName || ""),
        Number(item.unitPrice) || 0,
        Boolean(item.active),
        Number(item.sort) || 0,
        Number(item.inventory) || 0
      ]
    );


  sheet
    .getRange(
      2,
      1,
      rows.length,
      7
    )
    .setValues(rows);
}


/* =========================================================
   TRANSACTION ARCHIVE
   ========================================================= */

function archiveTransactions(
  transactions,
  transactionItems
) {

  if (!transactions.length) {
    return [];
  }


  const spreadsheet =
    getPOSSpreadsheet();


  const transactionSheet =
    spreadsheet.getSheetByName(
      TRANSACTIONS_SHEET
    );


  const transactionItemSheet =
    spreadsheet.getSheetByName(
      TRANSACTION_ITEMS_SHEET
    );


  if (!transactionSheet) {

    throw new Error(
      'Missing sheet "Transactions".'
    );
  }


  if (!transactionItemSheet) {

    throw new Error(
      'Missing sheet "TransactionItems".'
    );
  }


  /*
   * Read TransactionIDs already stored
   * in Google.
   *
   * This makes retries safe.
   */

  const existingIds =
    new Set();


  const lastRow =
    transactionSheet.getLastRow();


  if (lastRow > 1) {

    transactionSheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .getValues()
      .forEach(
        (row) => {

          const transactionId =
            String(
              row[0] || ""
            ).trim();


          if (transactionId) {

            existingIds.add(
              transactionId
            );
          }
        }
      );
  }


  /*
   * Select only transactions that are
   * not already stored in Google.
   */

  const newTransactions =
    transactions.filter(
      (transaction) => {

        const transactionId =
          String(
            transaction.transactionId ||
            ""
          ).trim();


        return (
          transactionId &&
          !existingIds.has(
            transactionId
          )
        );
      }
    );


  /*
   * Every TransactionID received from
   * the browser is considered archived
   * if this request completes.
   *
   * IDs that already existed in Google
   * are included so a retry can repair
   * the local archived flag.
   */

  const archivedTransactionIds =
    transactions
      .map(
        (transaction) =>
          String(
            transaction.transactionId ||
            ""
          ).trim()
      )
      .filter(Boolean);


  if (!newTransactions.length) {

    return archivedTransactionIds;
  }


  const newTransactionIds =
    new Set(
      newTransactions.map(
        (transaction) =>
          String(
            transaction.transactionId
          )
      )
    );


  const transactionRows =
    newTransactions.map(
      (transaction) => [

        String(
          transaction.transactionId
        ),

        String(
          transaction.paymentType ||
          ""
        ),

        Number(
          transaction.total
        ) || 0
      ]
    );


  /*
   * Only include line items belonging
   * to newly inserted transactions.
   *
   * We deliberately do not deduplicate
   * TransactionItems by TransactionID.
   * One transaction normally has
   * multiple item rows.
   */

  const transactionItemRows =
    transactionItems
      .filter(
        (item) =>
          newTransactionIds.has(
            String(
              item.transactionId
            )
          )
      )
      .map(
        (item) => [

          String(
            item.transactionId
          ),

          Number(
            item.itemId
          ),

          String(
            item.itemName ||
            ""
          ),

          Number(
            item.quantity
          ) || 0,

          Number(
            item.unitPrice
          ) || 0,

          String(
            item.paymentType ||
            ""
          )
        ]
      );


  /*
   * Write parent transactions first.
   */

  transactionSheet
    .getRange(
      transactionSheet.getLastRow() + 1,
      1,
      transactionRows.length,
      3
    )
    .setValues(
      transactionRows
    );


  /*
   * Then write their item rows.
   */

  if (transactionItemRows.length) {

    transactionItemSheet
      .getRange(
        transactionItemSheet.getLastRow() + 1,
        1,
        transactionItemRows.length,
        6
      )
      .setValues(
        transactionItemRows
      );
  }


  return archivedTransactionIds;
}


/* =========================================================
   TRANSACTION HISTORY
   ========================================================= */

function getTransactions(
  dateFrom,
  dateTo
) {

  const spreadsheet =
    getPOSSpreadsheet();


  const transactionSheet =
    spreadsheet.getSheetByName(
      TRANSACTIONS_SHEET
    );


  const transactionItemSheet =
    spreadsheet.getSheetByName(
      TRANSACTION_ITEMS_SHEET
    );


  if (!transactionSheet) {

    throw new Error(
      'Missing sheet "Transactions".'
    );
  }


  if (!transactionItemSheet) {

    throw new Error(
      'Missing sheet "TransactionItems".'
    );
  }


  /*
   * Convert YYYY-MM-DD into YYYYMMDD.
   *
   * Transaction IDs begin:
   *
   * ME-YYYYMMDD-
   */

  const fromKey =
    String(
      dateFrom || ""
    ).replace(
      /-/g,
      ""
    );


  const toKey =
    String(
      dateTo || ""
    ).replace(
      /-/g,
      ""
    );


  const transactions = [];

  let latestHistoricalDate = "";


  /*
   * Read Transactions.
   */

  const transactionLastRow =
    transactionSheet.getLastRow();


  if (transactionLastRow > 1) {

    const rows =
      transactionSheet
        .getRange(
          2,
          1,
          transactionLastRow - 1,
          3
        )
        .getValues();


    rows.forEach(
      (row) => {

        const transactionId =
          String(
            row[0] || ""
          ).trim();


        if (!transactionId) {
          return;
        }


        const match =
          transactionId.match(
            /^ME-(\d{8})-/
          );


        if (!match) {
          return;
        }


        const dateKey =
          match[1];


        /*
         * Determine the latest date in
         * the entire Google archive,
         * not merely in the requested
         * date range.
         */

        if (
          !latestHistoricalDate ||
          dateKey >
            latestHistoricalDate
        ) {

          latestHistoricalDate =
            dateKey;
        }


        /*
         * Apply the requested range.
         */

        if (
          fromKey &&
          dateKey < fromKey
        ) {
          return;
        }


        if (
          toKey &&
          dateKey > toKey
        ) {
          return;
        }


        transactions.push({
          transactionId,

          paymentType:
            String(
              row[1] || ""
            ),

          total:
            Number(
              row[2]
            ) || 0
        });
      }
    );
  }


  /*
   * Only return TransactionItems
   * belonging to the Transactions
   * selected above.
   */

  const transactionIds =
    new Set(
      transactions.map(
        (transaction) =>
          transaction.transactionId
      )
    );


  const transactionItems = [];


  if (transactionIds.size) {

    const itemLastRow =
      transactionItemSheet.getLastRow();


    if (itemLastRow > 1) {

      const rows =
        transactionItemSheet
          .getRange(
            2,
            1,
            itemLastRow - 1,
            6
          )
          .getValues();


      rows.forEach(
        (row) => {

          const transactionId =
            String(
              row[0] || ""
            ).trim();


          if (
            !transactionIds.has(
              transactionId
            )
          ) {
            return;
          }


          transactionItems.push({
            transactionId,

            itemId:
              Number(
                row[1]
              ),

            itemName:
              String(
                row[2] || ""
              ),

            quantity:
              Number(
                row[3]
              ) || 0,

            unitPrice:
              Number(
                row[4]
              ) || 0,

            paymentType:
              String(
                row[5] || ""
              )
          });
        }
      );
    }
  }


  /*
   * Convert YYYYMMDD back to
   * YYYY-MM-DD.
   */

  if (latestHistoricalDate) {

    latestHistoricalDate =
      latestHistoricalDate.slice(
        0,
        4
      ) +
      "-" +
      latestHistoricalDate.slice(
        4,
        6
      ) +
      "-" +
      latestHistoricalDate.slice(
        6,
        8
      );
  }


  return {
    transactions,
    transactionItems,
    latestHistoricalDate
  };
}


/* =========================================================
   SUMMARY
   ========================================================= */

function getSummary(
  dateFrom,
  dateTo
) {

  const spreadsheet =
    getPOSSpreadsheet();


  const transactionSheet =
    spreadsheet.getSheetByName(
      TRANSACTIONS_SHEET
    );


  const transactionItemSheet =
    spreadsheet.getSheetByName(
      TRANSACTION_ITEMS_SHEET
    );


  if (!transactionSheet) {

    throw new Error(
      'Missing sheet "Transactions".'
    );
  }


  if (!transactionItemSheet) {

    throw new Error(
      'Missing sheet "TransactionItems".'
    );
  }


  /*
   * Convert YYYY-MM-DD into YYYYMMDD.
   */

  const fromKey =
    String(
      dateFrom || ""
    ).replace(
      /-/g,
      ""
    );


  const toKey =
    String(
      dateTo || ""
    ).replace(
      /-/g,
      ""
    );


  const transactionIds =
    new Set();


  let amount = 0;
  let transactionCount = 0;
  let itemCount = 0;

  const itemTotals = {};

  /*
   * Sum matching Transactions.
   */

  const transactionLastRow =
    transactionSheet.getLastRow();


  if (transactionLastRow > 1) {

    const rows =
      transactionSheet
        .getRange(
          2,
          1,
          transactionLastRow - 1,
          3
        )
        .getValues();


    rows.forEach(
      (row) => {

        const transactionId =
          String(
            row[0] || ""
          ).trim();


        if (!transactionId) {
          return;
        }


        const match =
          transactionId.match(
            /^ME-(\d{8})-/
          );


        if (!match) {
          return;
        }


        const dateKey =
          match[1];


        if (
          fromKey &&
          dateKey < fromKey
        ) {
          return;
        }


        if (
          toKey &&
          dateKey > toKey
        ) {
          return;
        }


        transactionIds.add(
          transactionId
        );


        amount +=
          Number(
            row[2]
          ) || 0;


        transactionCount++;
      }
    );
  }


  /*
   * Sum quantities from matching
   * TransactionItems.
   */

  if (transactionIds.size) {

    const itemLastRow =
      transactionItemSheet.getLastRow();


    if (itemLastRow > 1) {

      const rows =
        transactionItemSheet
          .getRange(
            2,
            1,
            itemLastRow - 1,
            6
          )
          .getValues();


      rows.forEach(
        (row) => {

          const transactionId =
            String(
              row[0] || ""
            ).trim();


          if (
            !transactionIds.has(
              transactionId
            )
          ) {
            return;
          }


          const itemName =
            String(
              row[2] || ""
            ).trim();


          const quantity =
            Number(
              row[3]
            ) || 0;


          itemCount +=
            quantity;


          if (itemName) {

            itemTotals[itemName] =
              (
                Number(
                  itemTotals[itemName]
                ) || 0
              ) + quantity;
          }
            
        }
      );
    }
  }

  return {
    amount,

    transactions:
      transactionCount,

    items:
      itemCount,

    itemTotals
  };

}


/* =========================================================
   DELETE TRANSACTIONS
   ========================================================= */

function deleteTransactions(
  transactionIds
) {

  const ids =
    new Set(
      (Array.isArray(transactionIds)
        ? transactionIds
        : []
      )
        .map(
          (transactionId) =>
            String(
              transactionId || ""
            ).trim()
        )
        .filter(Boolean)
    );


  if (!ids.size) {
    return [];
  }


  const spreadsheet =
    getPOSSpreadsheet();


  const transactionSheet =
    spreadsheet.getSheetByName(
      TRANSACTIONS_SHEET
    );


  const transactionItemSheet =
    spreadsheet.getSheetByName(
      TRANSACTION_ITEMS_SHEET
    );


  if (!transactionSheet) {

    throw new Error(
      'Missing sheet "Transactions".'
    );
  }


  if (!transactionItemSheet) {

    throw new Error(
      'Missing sheet "TransactionItems".'
    );
  }


  const transactionLastRow =
    transactionSheet.getLastRow();


  /*
   * Delete child rows first.
   *
   * Work from the bottom upward so
   * deleting a row does not change the
   * row numbers still waiting to be
   * checked.
   */

  const itemLastRow =
    transactionItemSheet.getLastRow();


  if (itemLastRow > 1) {

    const values =
      transactionItemSheet
        .getRange(
          2,
          1,
          itemLastRow - 1,
          1
        )
        .getValues();


    for (
      let index =
        values.length - 1;
      index >= 0;
      index--
    ) {

      const transactionId =
        String(
          values[index][0] || ""
        ).trim();


      if (
        ids.has(
          transactionId
        )
      ) {

        transactionItemSheet.deleteRow(
          index + 2
        );
      }
    }
  }


  /*
   * Delete parent transaction rows.
   */

  if (transactionLastRow > 1) {

    const values =
      transactionSheet
        .getRange(
          2,
          1,
          transactionLastRow - 1,
          1
        )
        .getValues();


    for (
      let index =
        values.length - 1;
      index >= 0;
      index--
    ) {

      const transactionId =
        String(
          values[index][0] || ""
        ).trim();


      if (
        ids.has(
          transactionId
        )
      ) {

        transactionSheet.deleteRow(
          index + 2
        );
      }
    }
  }


  return [
    ...ids
  ];
}


/* =========================================================
   JSON RESPONSE
   ========================================================= */

function jsonResponse(object) {

  return ContentService
    .createTextOutput(
      JSON.stringify(object)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}