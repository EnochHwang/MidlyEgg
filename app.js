/*
 * MidlyEgg POS app
 *
 * The backend for manipulating the Google Sheet database is a Google Apps Script
 * named "MidlyEgg Backend" located in https://script.google.com/home
 * The Web App URL for this Apps Script must be put inside the config.js file.
 * The permissions for this Script are:
 *    Execute as: Me (enochhwangphd@gmail.com)
 *    Who has access: Anyone
 *
 * The full database is stored in a Google Sheet named "MidlyEgg POS Database"
 * and partially on the local device in IndexedDB.
 * On a new startup, this Google Sheet is automatically created in the root directory of My Drive.
 * The Google Sheet can be renamed and moved to any location within the same Google My Drive.
 * If the Sheet is deleted, a new one will be created.
 
 * 2026 October Enoch Hwang
 *
 */

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];


/* =========================================================
   INDEXEDDB
   ========================================================= */

const DB_NAME = "MidlyEggPOS";
const DB_VERSION = 1;

const ITEMS_STORE = "items";
const TRANSACTIONS_STORE = "transactions";
const TRANSACTION_ITEMS_STORE = "transactionItems";
const META_STORE = "meta";

// Global variables
let db = null;
let items = [];
let activeCategory = "All";
let cart = {};

let transactions = [];
let transactionItems = [];
let currentPage = "pos";  // keep track of the current page being viewed

let latestHistoricalDate = "";
let oldestLocalDate = "";

let summaryItemRankingData = [];  // individual-item Summary data for the current Summary page.
let summaryItemSort = "event";

/*
 * Service-worker version that was running
 * when this page was loaded.
 *
 * If a different version later takes control,
 * an application update is available.
 */

let loadedAppVersion = "";
let appUpdateAvailable = false;

/* =========================================================
   OPEN DATABASE
   ========================================================= */

function openDatabase() {

  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        DB_NAME,
        DB_VERSION
      );


    request.onupgradeneeded = (event) => {

      const database =
        event.target.result;


      /*
       * Items
       */

      database.createObjectStore(
        ITEMS_STORE,
        {
          keyPath: "itemId"
        }
      );


      /*
       * Transactions
       */

      database.createObjectStore(
        TRANSACTIONS_STORE,
        {
          keyPath:
            "transactionId"
        }
      );


      /*
       * Transaction Items
       */

      const transactionItemStore =
        database.createObjectStore(
          TRANSACTION_ITEMS_STORE,
          {
            keyPath: "rowId",
            autoIncrement: true
          }
        );


      transactionItemStore.createIndex(
        "transactionId",
        "transactionId",
        {
          unique: false
        }
      );


      transactionItemStore.createIndex(
        "itemId",
        "itemId",
        {
          unique: false
        }
      );


      /*
       * Internal Metadata
       */

      database.createObjectStore(
        META_STORE,
        {
          keyPath: "key"
        }
      );
    };


    request.onsuccess = () => {

      db = request.result;

      resolve(db);
    };


    request.onerror = () => {

      reject(request.error);
    };
  });
}

/* =========================================================
   BASIC DATABASE HELPERS
   ========================================================= */

function getStore(storeName, mode = "readonly") {
  const transaction =
    db.transaction(
      storeName,
      mode
    );

  return transaction.objectStore(
    storeName
  );
}

async function initializeMetadata() {

  const nextItemId =
    await getMeta(
      "nextItemId"
    );


  if (nextItemId === null) {

    const existingItems =
      await getAllRecords(
        ITEMS_STORE
      );


    const highestItemId =
      existingItems.reduce(
        (highest, item) =>
          Math.max(
            highest,
            Number(item.itemId) || 0
          ),
        0
      );


    await setMeta(
      "nextItemId",
      highestItemId + 1
    );
  }


  const itemsDirty =
    await getMeta(
      "itemsDirty"
    );


  if (itemsDirty === null) {

    await setMeta(
      "itemsDirty",
      false
    );
  }
  
  /*
   * Latest transaction date known
   * to exist in Google.
   *
   * Blank means we have not learned
   * Google's historical extent yet.
   */

  latestHistoricalDate =
    await getMeta(
      "latestHistoricalDate",
      ""
    );


  /*
   * Earliest date for which the local
   * transaction history is known to be
   * complete.
   */

  oldestLocalDate =
    await getMeta(
      "oldestLocalDate",
      ""
    );


  /*
   * First-time initialization:
   *
   * If oldestLocalDate has never been
   * established, derive it from the
   * oldest transaction currently in
   * IndexedDB.
   */

  if (!oldestLocalDate) {

    const localTransactions =
      await getAllRecords(
        TRANSACTIONS_STORE
      );


    localTransactions.forEach(
      (transaction) => {

        const localDate =
          getTransactionLocalDate(
            transaction.transactionId
          );


        if (
          localDate &&
          (
            !oldestLocalDate ||
            localDate <
              oldestLocalDate
          )
        ) {

          oldestLocalDate =
            localDate;
        }
      }
    );


    if (oldestLocalDate) {

      await setMeta(
        "oldestLocalDate",
        oldestLocalDate
      );
    }
  }  
  
}

async function getMeta(key, defaultValue = null) {

  const record =
    await getRecord(
      META_STORE,
      key
    );

  if (!record) {
    return defaultValue;
  }

  return record.value;
}

async function setMeta(key, value) {

  await putRecord(
    META_STORE,
    {
      key,
      value
    }
  );
}


function getAllRecords(storeName) {
  return new Promise(
    (resolve, reject) => {

      const request =
        getStore(
          storeName
        ).getAll();


      request.onsuccess =
        () => {
          resolve(
            request.result
          );
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


function getRecord(storeName, key) {
  return new Promise(
    (resolve, reject) => {

      const request =
        getStore(
          storeName
        ).get(key);


      request.onsuccess =
        () => {
          resolve(
            request.result
          );
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


function putRecord(storeName, record) {
  return new Promise(
    (resolve, reject) => {

      const request =
        getStore(
          storeName,
          "readwrite"
        ).put(record);


      request.onsuccess =
        () => {
          resolve(
            request.result
          );
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


function deleteRecord(storeName, key) {
  return new Promise(
    (resolve, reject) => {

      const request =
        getStore(
          storeName,
          "readwrite"
        ).delete(key);


      request.onsuccess =
        () => {
          resolve();
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


function clearStore(storeName) {
  return new Promise(
    (resolve, reject) => {

      const request =
        getStore(
          storeName,
          "readwrite"
        ).clear();


      request.onsuccess =
        () => {
          resolve();
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


/* =========================================================
   GOOGLE API
   ========================================================= */

async function googleRequest(
  action,
  data = {}
) {

  const apiUrl =
    window.POS_CONFIG?.API_URL;


  if (!apiUrl) {

    throw new Error(
      "Google API URL is not configured."
    );
  }


  const response =
    await fetch(
      apiUrl,
      {
        method: "POST",

        body:
          JSON.stringify({
            action,
            ...data
          })
      }
    );


  if (!response.ok) {

    throw new Error(
      "Google API request failed."
    );
  }


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      result.error ||
      "Google API request failed."
    );
  }


  return result;
}


/* =========================================================
   TRANSACTION ARCHIVE
   ========================================================= */

async function archiveTransactions(throwOnError = false) {
  /*
   * archived:false acts as the
   * transaction archive queue.
   */

  const localTransactions =
    await getAllRecords(
      TRANSACTIONS_STORE
    );


  const unarchivedTransactions =
    localTransactions.filter(
      (transaction) =>
        transaction.archived === false
    );


  if (!unarchivedTransactions.length) {
    return;
  }


  const unarchivedIds =
    new Set(
      unarchivedTransactions.map(
        (transaction) =>
          transaction.transactionId
      )
    );


  const localTransactionItems =
    await getAllRecords(
      TRANSACTION_ITEMS_STORE
    );


  const unarchivedTransactionItems =
    localTransactionItems.filter(
      (item) =>
        unarchivedIds.has(
          item.transactionId
        )
    );


  try {

    const result =
      await googleRequest(
        "archiveTransactions",
        {
          transactions:
            unarchivedTransactions,

          transactionItems:
            unarchivedTransactionItems
        }
      );


    const archivedIds =
      new Set(
        Array.isArray(
          result.archivedTransactionIds
        )
          ? result.archivedTransactionIds
          : []
      );


    if (!archivedIds.size) {
      return;
    }


    /*
     * Mark only transactions confirmed
     * by Google as archived.
     */

    /*
     * Find the newest date among the
     * transactions Google confirmed.
     */

    let newestArchivedDate = "";


    unarchivedTransactions.forEach(
      (transaction) => {

        if (
          !archivedIds.has(
            transaction.transactionId
          )
        ) {
          return;
        }


        const transactionDate =
          getTransactionLocalDate(
            transaction.transactionId
          );


        if (
          transactionDate &&
          (
            !newestArchivedDate ||
            transactionDate >
              newestArchivedDate
          )
        ) {

          newestArchivedDate =
            transactionDate;
        }
      }
    );


    const shouldUpdateLatestHistoricalDate =
      newestArchivedDate &&
      (
        !latestHistoricalDate ||
        newestArchivedDate >
          latestHistoricalDate
      );

  
    await new Promise(
      (resolve, reject) => {

        const databaseTransaction =
          db.transaction(
            [
              TRANSACTIONS_STORE,
              META_STORE
            ],
            "readwrite"
          );


        const transactionStore =
          databaseTransaction.objectStore(
            TRANSACTIONS_STORE
          );


        const metaStore =
          databaseTransaction.objectStore(
            META_STORE
          );

        unarchivedTransactions.forEach(
          (transaction) => {

            if (
              archivedIds.has(
                transaction.transactionId
              )
            ) {

              transactionStore.put({
                ...transaction,
                archived: true
              });
            }
          }
        );

        if (
          shouldUpdateLatestHistoricalDate
        ) {

          metaStore.put({
            key: "latestHistoricalDate",
            value: newestArchivedDate
          });
        }

        databaseTransaction.oncomplete =
          () => {

            if (
              shouldUpdateLatestHistoricalDate
            ) {

              latestHistoricalDate =
                newestArchivedDate;
            }


            resolve();
          };

        databaseTransaction.onerror =
          () => {
            reject(
              databaseTransaction.error
            );
          };


        databaseTransaction.onabort =
          () => {
            reject(
              databaseTransaction.error ||
              new Error(
                "Archive status could not be updated."
              )
            );
          };
      }
    );


    console.log(
      `${archivedIds.size} transaction(s) archived to Google.`
    );


  } catch (error) {

    /*
     * Leave archived:false.
     *
     * The transaction will be retried
     * later.
     */

    console.error(
      "Unable to archive transactions:",
      error
    );


    /*
     * Normal background archiving must
     * remain silent.
     *
     * An export, however, requires Google
     * to be completely current before the
     * workbook can be created.
     */

    if (throwOnError) {
      throw error;
    }
  }
}


/* =========================================================
   CREATE REPORT
   ========================================================= */

async function syncTransactionsForReport() {

  const beforeSync =
    await getAllRecords(
      TRANSACTIONS_STORE
    );

  const pendingBeforeSync =
    beforeSync.filter(
      (transaction) =>
        transaction.archived === false
    );

  if (pendingBeforeSync.length) {

    await archiveTransactions(true);
    
  }


  const afterSync =
    await getAllRecords(
      TRANSACTIONS_STORE
    );


  const pendingAfterSync =
    afterSync.filter(
      (transaction) =>
        transaction.archived === false
    );

  if (pendingAfterSync.length) {

    throw new Error(
      `${pendingAfterSync.length} transaction(s) could not be synchronized with Google.`
    );
  }

}

function updateReportFileName() {

  const dateFrom =
    $("#reportDateFrom").value;

  const dateTo =
    $("#reportDateTo").value;


  if (
    !dateFrom ||
    !dateTo
  ) {
    return;
  }


  $("#reportFileName").value =
    dateFrom === dateTo
      ? `MidlyEgg-Report-${dateFrom}.xlsx`
      : (
          `MidlyEgg-Report-` +
          `${dateFrom}-to-${dateTo}.xlsx`
        );
}

/*
function createTransactionReportWorkbook(
  transactions,
  transactionItems
) {

  if (
    typeof XLSX === "undefined"
  ) {

    throw new Error(
      "Excel report library is not available."
    );
  }


  const transactionRows = [

    [
      "TransactionID",
      "PaymentType",
      "Total"
    ],

    ...transactions.map(
      (transaction) => [

        transaction.transactionId,

        transaction.paymentType,

        Number(
          transaction.total
        ) || 0
      ]
    )
  ];


  const transactionItemRows = [

    [
      "TransactionID",
      "ItemID",
      "ItemName",
      "Quantity",
      "UnitPrice",
      "PaymentType"
    ],

    ...transactionItems.map(
      (item) => [

        item.transactionId,

        Number(
          item.itemId
        ),

        item.itemName,

        Number(
          item.quantity
        ) || 0,

        Number(
          item.unitPrice
        ) || 0,

        item.paymentType
      ]
    )
  ];


  const workbook =
    XLSX.utils.book_new();


  const transactionsSheet =
    XLSX.utils.aoa_to_sheet(
      transactionRows
    );


  const transactionItemsSheet =
    XLSX.utils.aoa_to_sheet(
      transactionItemRows
    );


  XLSX.utils.book_append_sheet(
    workbook,
    transactionsSheet,
    "Transactions"
  );


  XLSX.utils.book_append_sheet(
    workbook,
    transactionItemsSheet,
    "Transaction Items"
  );


  return workbook;
}
*/

async function createTransactionReportWorkbook(
  transactions,
  transactionItems,
  dateFrom,
  dateTo
) {

  if (
    typeof ExcelJS === "undefined"
  ) {

    throw new Error(
      "Excel report library is not available."
    );
  }

  /*
   * -------------------------------------------------------
   * Determine all items appearing in the report.
   * -------------------------------------------------------
   */

  const itemMap =
    new Map();


  transactionItems.forEach(
    (item) => {

      const itemId =
        String(
          item.itemId
        );


      if (
        !itemMap.has(
          itemId
        )
      ) {

        itemMap.set(
          itemId,
          {
            itemId:
              item.itemId,

            itemName:
              item.itemName
          }
        );
      }
    }
  );


  const reportItems =
    Array.from(
      itemMap.values()
    );


  /*
   * -------------------------------------------------------
   * Group line items by transaction.
   * -------------------------------------------------------
   */

  const itemsByTransaction =
    new Map();


  transactionItems.forEach(
    (item) => {

      const transactionId =
        item.transactionId;


      if (
        !itemsByTransaction.has(
          transactionId
        )
      ) {

        itemsByTransaction.set(
          transactionId,
          []
        );
      }


      itemsByTransaction
        .get(
          transactionId
        )
        .push(
          item
        );
    }
  );


  /*
   * -------------------------------------------------------
   * Create workbook and worksheet.
   * -------------------------------------------------------
   */

  const workbook =
    new ExcelJS.Workbook();


  const worksheet =
    workbook.addWorksheet(
      "Transactions",
      {
        views: [
          {
            state: "frozen",

            /*
             * Freeze rows 1 through 6.
             */

            ySplit: 6,

            /*
             * Do not freeze columns.
             */

            xSplit: 0
          }
        ]
      }
    );


  /*
   * Number of columns:
   *
   * Transaction ID
   * Date
   * Payment
   * Transaction Total
   * two columns per item
   */

  const totalColumns =
    4 +
    (
      reportItems.length * 2
    );


  /*
   * -------------------------------------------------------
   * Report heading.
   * -------------------------------------------------------
   */

  worksheet.mergeCells(
    1,
    1,
    1,
    totalColumns
  );


  worksheet.getCell(
    1,
    1
  ).value =
    "MidlyEgg";


  worksheet.mergeCells(
    2,
    1,
    2,
    totalColumns
  );


  worksheet.getCell(
    2,
    1
  ).value =
    "Transaction Report";


  worksheet.mergeCells(
    3,
    1,
    3,
    totalColumns
  );


  worksheet.getCell(
    3,
    1
  ).value =
    dateFrom === dateTo
      ? `Date: ${dateFrom}`
      : (
          `Date Range: ` +
          `${dateFrom} to ${dateTo}`
        );


  /*
   * Bold the top three rows.
   */

  for (
    let rowNumber = 1;
    rowNumber <= 3;
    rowNumber++
  ) {

    worksheet
      .getRow(
        rowNumber
      )
      .font = {
        bold: true
      };
  }


  /*
   * Slightly emphasize the main title.
   */

  worksheet.getCell(
    "A1"
  ).font = {
    bold: true,
    size: 16
  };


  worksheet.getCell(
    "A2"
  ).font = {
    bold: true,
    size: 13
  };


  /*
   * -------------------------------------------------------
   * Header rows 5 and 6.
   * -------------------------------------------------------
   */

  worksheet.mergeCells(
    "A5:A6"
  );

  worksheet.getCell(
    "A5"
  ).value =
    "Transaction ID";


  worksheet.mergeCells(
    "B5:B6"
  );

  worksheet.getCell(
    "B5"
  ).value =
    "Date";


  worksheet.mergeCells(
    "C5:C6"
  );

  worksheet.getCell(
    "C5"
  ).value =
    "Payment";


  /*
   * Transaction Total now comes BEFORE the item columns.
   */

  worksheet.mergeCells(
    "D5:D6"
  );

  worksheet.getCell(
    "D5"
  ).value =
    "Transaction Total";

  /*
   * Item columns begin with column E.
   */

  reportItems.forEach(
    (item, index) => {

      const qtyColumn =
        5 +
        (
          index * 2
        );


      const subtotalColumn =
        qtyColumn + 1;


      /*
       * Merge the item name across Qty + Subtotal.
       */

      worksheet.mergeCells(
        5,
        qtyColumn,
        5,
        subtotalColumn
      );


      const itemCell =
        worksheet.getCell(
          5,
          qtyColumn
        );


      itemCell.value =
        item.itemName;


      /*
       * Center item name across both columns.
       */

      itemCell.alignment = {
        horizontal: "center",
        vertical: "middle"
      };


      worksheet.getCell(
        6,
        qtyColumn
      ).value =
        "Qty";


      worksheet.getCell(
        6,
        subtotalColumn
      ).value =
        "Subtotal";
    }
  );


  /*
   * Bold header rows 5 and 6.
   */

  worksheet.getRow(
    5
  ).font = {
    bold: true
  };


  worksheet.getRow(
    6
  ).font = {
    bold: true
  };


  /*
   * Center all header cells.
   */

  for (
    let rowNumber = 5;
    rowNumber <= 6;
    rowNumber++
  ) {

    worksheet
      .getRow(
        rowNumber
      )
      .alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true
      };
  }


  /*
   * -------------------------------------------------------
   * Transaction rows begin at row 7.
   * -------------------------------------------------------
   */

  let currentRow =
    7;


  transactions.forEach(
    (transaction) => {

      let transactionDate =
        "";


      const dateMatch =
        String(
          transaction.transactionId
        ).match(
          /^ME-(\d{4})(\d{2})(\d{2})-/
        );


      if (dateMatch) {

        transactionDate =
          `${dateMatch[1]}-` +
          `${dateMatch[2]}-` +
          `${dateMatch[3]}`;
      }


      const row =
        worksheet.getRow(
          currentRow
        );


      row.getCell(
        1
      ).value =
        transaction.transactionId;


      row.getCell(
        2
      ).value =
        transactionDate;


      row.getCell(
        3
      ).value =
        transaction.paymentType;


      /*
       * Transaction Total.
       */

      row.getCell(
        4
      ).value =
        Number(
          transaction.total
        ) || 0;


      row.getCell(
        4
      ).numFmt =
        "$#,##0"; // 0.00


      const transactionLineItems =
        itemsByTransaction.get(
          transaction.transactionId
        ) || [];


      const transactionItemMap =
        new Map();


      transactionLineItems.forEach(
        (lineItem) => {

          const itemId =
            String(
              lineItem.itemId
            );


          const quantity =
            Number(
              lineItem.quantity
            ) || 0;


          const unitPrice =
            Number(
              lineItem.unitPrice
            ) || 0;


          if (
            transactionItemMap.has(
              itemId
            )
          ) {

            const existing =
              transactionItemMap.get(
                itemId
              );


            existing.quantity +=
              quantity;


            existing.subtotal +=
              quantity *
              unitPrice;

          } else {

            transactionItemMap.set(
              itemId,
              {
                quantity,

                subtotal:
                  quantity *
                  unitPrice
              }
            );
          }
        }
      );


      /*
       * Item Qty + Subtotal columns.
       */

      reportItems.forEach(
        (item, index) => {

          const qtyColumn =
            5 +
            (
              index * 2
            );


          const subtotalColumn =
            qtyColumn + 1;


          const line =
            transactionItemMap.get(
              String(
                item.itemId
              )
            );


          if (line) {

            row.getCell(
              qtyColumn
            ).value =
              line.quantity;


            row.getCell(
              subtotalColumn
            ).value =
              line.subtotal;


            row.getCell(
              subtotalColumn
            ).numFmt =
              "$#,##0"; // 0.00
          }
        }
      );


      currentRow++;
    }
  );


  /*
   * -------------------------------------------------------
   * TOTALS row.
   * -------------------------------------------------------
   */

  const totalsRowNumber =
    currentRow;


  const totalsRow =
    worksheet.getRow(
      totalsRowNumber
    );


  totalsRow.getCell(
    1
  ).value =
    "TOTALS";


  /*
   * Transaction Total formula.
   */

  totalsRow.getCell(
    4
  ).value = {
    formula:
      `SUM(D7:D${totalsRowNumber - 1})`
  };


  totalsRow.getCell(
    4
  ).numFmt =
    "$#,##0";  // 0.00


  /*
   * Item totals.
   */

  reportItems.forEach(
    (item, index) => {

      const qtyColumn =
        5 +
        (
          index * 2
        );


      const subtotalColumn =
        qtyColumn + 1;


      const qtyLetter =
        worksheet
          .getColumn(
            qtyColumn
          )
          .letter;


      const subtotalLetter =
        worksheet
          .getColumn(
            subtotalColumn
          )
          .letter;


      totalsRow.getCell(
        qtyColumn
      ).value = {
        formula:
          `SUM(${qtyLetter}7:` +
          `${qtyLetter}${totalsRowNumber - 1})`
      };


      totalsRow.getCell(
        subtotalColumn
      ).value = {
        formula:
          `SUM(${subtotalLetter}7:` +
          `${subtotalLetter}${totalsRowNumber - 1})`
      };


      totalsRow.getCell(
        subtotalColumn
      ).numFmt =
        "$#,##0"; // 0.00
    }
  );


  /*
   * Bold TOTALS row.
   */

  totalsRow.font = {
    bold: true
  };


  /*
   * -------------------------------------------------------
   * Column widths.
   * -------------------------------------------------------
   */

  worksheet.getColumn(
    1
  ).width =
    25;


  worksheet.getColumn(
    2
  ).width =
    13;


  worksheet.getColumn(
    3
  ).width =
    12;


  worksheet.getColumn(
    4
  ).width =
    12;


  reportItems.forEach(
    (item, index) => {

      const qtyColumn =
        5 +
        (
          index * 2
        );


      const subtotalColumn =
        qtyColumn + 1;


      /*
       * Narrow Qty columns.
       */

      worksheet.getColumn(
        qtyColumn
      ).width =
        6;


      worksheet.getColumn(
        subtotalColumn
      ).width =
        12;
    }
  );

  return workbook;
}

async function saveTransactionReportWorkbook(
  workbook,
  fileName
) {

  if (
    !fileName
      .toLowerCase()
      .endsWith(".xlsx")
  ) {

    fileName += ".xlsx";
  }

  /*
   * ExcelJS creates the XLSX file
   * asynchronously.
   */

  const workbookData =
    await workbook.xlsx.writeBuffer();


  const blob =
    new Blob(
      [workbookData],
      {
        type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    );


  if (
    "showSaveFilePicker" in window
  ) {

    const fileHandle =
      await window.showSaveFilePicker({
        suggestedName:
          fileName,

        types: [
          {
            description:
              "Excel Workbook",

            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                [".xlsx"]
            }
          }
        ]
      });


    const writable =
      await fileHandle.createWritable();


    await writable.write(
      blob
    );


    await writable.close();

    return;
  }


  /*
   * Desktop-browser fallback.
   */

  const downloadUrl =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      "a"
    );


  link.href =
    downloadUrl;

  link.download =
    fileName;


  document.body.appendChild(
    link
  );


  link.click();

  link.remove();


  setTimeout(
    () => {

      URL.revokeObjectURL(
        downloadUrl
      );

    },
    10000
  );
}

async function createTransactionReport(
  dateFrom,
  dateTo,
  fileName
) {

  console.log(
    "Starting report creation."
  );


  if (
    !dateFrom ||
    !dateTo
  ) {

    toast(
      "Select both report dates."
    );

    return;
  }


  if (dateFrom > dateTo) {

    toast(
      "The From date cannot be after the To date."
    );

    return;
  }


  if (!fileName) {

    toast(
      "Enter a report filename."
    );

    return;
  }


  if (!navigator.onLine) {

    toast(
      "An internet connection is required to create the report."
    );

    return;
  }


  const createButton =
    $("#confirmCreateReport");


  try {

    createButton.disabled =
      true;


    $("#status").textContent =
      "Syncing transactions...";

    await syncTransactionsForReport();


    $("#status").textContent =
      "Generating report...";

    const result =
      await googleRequest(
        "getTransactions",
        {
          dateFrom,
          dateTo
        }
      );


    const reportTransactions =
      Array.isArray(
        result.transactions
      )
        ? result.transactions
        : [];


    const reportTransactionItems =
      Array.isArray(
        result.transactionItems
      )
        ? result.transactionItems
        : [];


    if (!reportTransactions.length) {

      toast(
        "No transactions found in that date range."
      );

      return;
    }


    $("#status").textContent =
      "Saving report...";

    const workbook =
      await createTransactionReportWorkbook(
        reportTransactions,
        reportTransactionItems,
        dateFrom,
        dateTo
      );

    await saveTransactionReportWorkbook(
      workbook,
      fileName
    );


    console.log(
      "Report generated and saved."
    );


    toast(
      `Report saved with ${reportTransactions.length} transaction(s).`
    );


  } catch (error) {

    if (
      error?.name === "AbortError"
    ) {

      toast(
        "Report cancelled."
      );

    } else {

      console.error(
        "Report generation failed:",
        error
      );


      toast(
        "Report failed. See console for details."
      );
    }


  } finally {

    $("#status").textContent =
      "Online";


    createButton.disabled =
      false;
      
  }
}


/* =========================================================
   STARTUP ITEMS
   ========================================================= */

async function initializeItems() {

  /*
   * IndexedDB is authoritative whenever
   * it contains at least one Item.
   */

  const localItems =
    await getAllRecords(
      ITEMS_STORE
    );


  if (localItems.length) {
    return;
  }


  /*
   * The local Items store is empty.
   *
   * Use Google only as a bootstrap /
   * recovery source.
   */

  console.log(
    "Local Items empty. Checking Google."
  );


  try {

    const result =
      await googleRequest(
        "getItems"
      );


    const googleItems =
      Array.isArray(
        result.items
      )
        ? result.items
        : [];


    if (!googleItems.length) {

      console.log(
        "Google Items is also empty."
      );

      return;
    }


    /*
     * Import the complete Google Items
     * snapshot into IndexedDB.
     */

    await new Promise(
      (resolve, reject) => {

        const transaction =
          db.transaction(
            [
              ITEMS_STORE,
              META_STORE
            ],
            "readwrite"
          );


        const itemStore =
          transaction.objectStore(
            ITEMS_STORE
          );


        const metaStore =
          transaction.objectStore(
            META_STORE
          );


        let highestItemId = 0;


        googleItems.forEach(
          (item) => {

            const itemId =
              Number(
                item.itemId
              );


            if (
              !Number.isInteger(itemId) ||
              itemId <= 0
            ) {
              return;
            }


            highestItemId =
              Math.max(
                highestItemId,
                itemId
              );


            itemStore.put({
              itemId,

              category:
                String(
                  item.category || ""
                ),

              itemName:
                String(
                  item.itemName || ""
                ),

              unitPrice:
                Number(
                  item.unitPrice
                ) || 0,

              active:
                Boolean(
                  item.active
                ),

              sort:
                Number(
                  item.sort
                ) || 0,

              inventory:
                Number(
                  item.inventory
                ) || 0
            });
          }
        );


        metaStore.put({
          key: "nextItemId",
          value:
            highestItemId + 1
        });


        metaStore.put({
          key: "itemsDirty",
          value: false
        });


        transaction.oncomplete =
          () => {
            resolve();
          };


        transaction.onerror =
          () => {
            reject(
              transaction.error
            );
          };


        transaction.onabort =
          () => {
            reject(
              transaction.error ||
              new Error(
                "Google Items could not be imported."
              )
            );
          };
      }
    );


    console.log(
      `${googleItems.length} Items imported from Google.`
    );


  } catch (error) {

    /*
     * Google being unavailable must not
     * prevent the POS from starting.
     */

    console.error(
      "Unable to load Google Items:",
      error
    );
  }
}

async function backupItems() {

  const itemsDirty =
    await getMeta(
      "itemsDirty",
      false
    );


  if (!itemsDirty) {
    return;
  }


  const currentItems =
    await getAllRecords(
      ITEMS_STORE
    );


  try {

    await googleRequest(
      "replaceItems",
      {
        items: currentItems
      }
    );


    await setMeta(
      "itemsDirty",
      false
    );


  } catch (error) {

    /*
     * Leave itemsDirty true so the
     * backup can be attempted again.
     */

    console.error(
      "Unable to update Items backup:",
      error
    );
  }
}


/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

function showPage(pageId) {

  const previousPage =
    currentPage;

  currentPage =
    pageId;


  /*
   * Leaving Manage Items.
   *
   * Do not wait for Google before
   * changing pages.
   */

  if (
    previousPage === "items" &&
    pageId !== "items"
  ) {

    backupItems();
  }


  $$(".page").forEach(  
    (page) => {
      page.classList.remove(
        "active"
      );
    }
  );


  const page =
    document.getElementById(
      pageId
    );


  if (page) {
    page.classList.add(
      "active"
    );
  }


  /*
   * Manage Transactions defaults
   * to today's transactions.
   */

  if (pageId === "tx") {

    $("#dateFrom").value =
      getTodayLocalDate();

    $("#dateTo").value =
      getTodayLocalDate();

    loadTransactionHistory();
  }

  if (pageId === "summary") {

    /*
     * Each visit starts sorted by Event.
     */

    $("#status").textContent = "Generating summary...";
     
    summaryItemSort = "event";

    summaryItemRankingData = [];

    updateSummarySortHeadings();

    loadSummary().finally(() => {
      $("#status").textContent = "Online";
    });
    
  }
  
  $("#settingsDropdown")
    .classList.remove("open");
}


function initializeNavigation() {

  $("#settingsButton").onclick =
    (event) => {

      event.stopPropagation();

      const isOpen =
        $("#settingsDropdown")
          .classList.toggle(
            "open"
          );

      $("#settingsButton")
        .setAttribute(
          "aria-expanded",
          String(isOpen)
        );
    };

    
  $("#updateAvailable").onclick =
    () => {

      if (
        !appUpdateAvailable ||
        getCartLines().length
      ) {
        return;
      }

      window.location.reload();
    };
    
    
  $$("[data-page]").forEach(
    (button) => {

      button.onclick =
        () => {
          showPage(
            button.dataset.page
          );
        };
    }
  );


  /*
   * Create Report.
   */

  if (isMobileDevice()) {

    $("#createReport").disabled =
      true;

  } else {

    $("#createReport").disabled =
      false;

  }


  $("#createReport").onclick =
    () => {

      const today =
        getTodayLocalDate();


      $("#reportDateFrom").value =
        today;

      $("#reportDateTo").value =
        today;


      updateReportFileName();


      $("#settingsDropdown")
        .classList.remove(
          "open"
        );


      $("#settingsButton")
        .setAttribute(
          "aria-expanded",
          "false"
        );


      $("#createReportDlg")
        .showModal();
    };


  $("#reportDateFrom").onchange =
    updateReportFileName;


  $("#reportDateTo").onchange =
    updateReportFileName;


  $("#cancelCreateReport").onclick =
    () => {

      $("#createReportDlg").close();
    };


  $("#createReportForm").onsubmit =
    async (event) => {

      event.preventDefault();


      const dateFrom =
        $("#reportDateFrom").value;

      const dateTo =
        $("#reportDateTo").value;

      const fileName =
        $("#reportFileName")
          .value
          .trim();


      /*
       * Close immediately so the user can
       * see report progress.
       */

      $("#createReportDlg").close();

      await createTransactionReport(
        dateFrom,
        dateTo,
        fileName
      );
    };
  
  $("#homeButton").onclick =
    () => {
      showPage("pos");
    };


  /*
   * Individual-item Summary headings
   * change only the ordering of the
   * already-loaded data.
   *
   * Sorting never reloads IndexedDB or
   * contacts Google.
   */

  $$("[data-summary-sort]")
    .forEach(
      (heading) => {

        heading.addEventListener(
          "click",
          () => {

            summaryItemSort =
              heading.dataset.summarySort;

            updateSummarySortHeadings();
            renderSummaryItemRanking();
          }
        );
      }
    );
    
    
  document.addEventListener(
    "click",
    (event) => {

      if (
        !event.target.closest(
          "#settingsButton"
        ) &&
        !event.target.closest(
          "#settingsDropdown"
        )
      ) {

        $("#settingsDropdown")
          .classList.remove("open");

        $("#settingsButton")
          .setAttribute(
            "aria-expanded",
            "false"
          );
      }
    }
  );
  
}


/* =========================================================
   POS CATEGORIES
   ========================================================= */

function renderCategories() {
  const activeItems =
    items.filter(
      (item) => item.active
    );


  const categories = [
    "All",
    ...new Set(
      activeItems.map(
        (item) => item.category
      )
    )
  ];


  $("#cats").innerHTML =
    categories
      .map((category) => {
        return `
          <button
            class="${
              category === activeCategory
                ? "active"
                : ""
            }"
            data-cat="${escapeHtml(
              category
            )}"
          >
            ${escapeHtml(category)}
          </button>
        `;
      })
      .join("");


  $$("[data-cat]").forEach(
    (button) => {

      button.onclick = () => {
        activeCategory =
          button.dataset.cat;

        renderCategories();
        renderProducts();
      };
    }
  );
}


/* =========================================================
   POS PRODUCTS
   ========================================================= */
   
/* create the POS item ordering page */
function renderProducts() {

  const categoryOrder = [
    ...new Set(
      items
        .filter((item) => item.active)
        .map((item) => item.category)
    )
  ];


  const products = items
    .filter((item) => {
      return (
        item.active &&
        (
          activeCategory === "All" ||
          item.category === activeCategory
        )
      );
    })
    .sort((a, b) => {

      if (activeCategory === "All") {

        const categoryDifference =
          categoryOrder.indexOf(a.category) -
          categoryOrder.indexOf(b.category);

        if (categoryDifference !== 0) {
          return categoryDifference;
        }
      }

      return (
        (a.sort || 0) -
        (b.sort || 0)
      );
    });


  $("#products").innerHTML = products
    .map((item) => {

      const quantityBadge =
        cart[item.itemId]
          ? `<span class="qty">${cart[item.itemId]}</span>`
          : "";

      return `
        <button
          class="product"
          data-product="${item.itemId}"
        >
          <b>${escapeHtml(item.itemName)}</b>

          <span class="price">
            ${money(item.unitPrice)}
          </span>

          ${quantityBadge}
        </button>
      `;
    })
    .join("");


  $$("[data-product]").forEach(
    (button) => {

      const id =
        Number(
          button.dataset.product
        );

      let longPressTimer = null;
      let longPressTriggered = false;


      button.addEventListener(
        "pointerdown",
        (event) => {

          if (
            event.pointerType === "mouse" &&
            event.button !== 0
          ) {
            return;
          }

          event.preventDefault();

          longPressTriggered = false;

          longPressTimer =
            setTimeout(
              () => {

                longPressTriggered = true;

                changeQuantity(
                  id,
                  -1
                );

                longPressTimer = null;

              },
              350
            );
        }
      );


      button.addEventListener(
        "pointerup",
        (event) => {

          event.preventDefault();

          if (longPressTimer) {

            clearTimeout(
              longPressTimer
            );

            longPressTimer = null;

            changeQuantity(
              id,
              1
            );

            return;
          }

          if (longPressTriggered) {
            return;
          }
        }
      );


      button.addEventListener(
        "click",
        (event) => {

          if (longPressTriggered) {

            event.preventDefault();
            event.stopPropagation();

            longPressTriggered = false;
          }
        }
      );


      button.addEventListener(
        "pointercancel",
        () => {

          if (longPressTimer) {

            clearTimeout(
              longPressTimer
            );

            longPressTimer = null;
          }

          longPressTriggered = false;
        }
      );


      button.addEventListener(
        "contextmenu",
        (event) => {
          event.preventDefault();
        }
      );
    }
  );
}


function changeQuantity(itemId, amount) {

  cart[itemId] =
    Math.max(
      0,
      (cart[itemId] || 0) +
        amount
    );


  if (!cart[itemId]) {
    delete cart[itemId];
  }


  renderProducts();
  renderCart();
}


/* =========================================================
   CART
   ========================================================= */

function getCartLines() {

  return Object.entries(cart)
    .map(([itemId, quantity]) => {

      const item =
        items.find(
          (candidate) => {
            return (
              candidate.itemId ===
              Number(itemId)
            );
          }
        );


      if (!item) {
        return null;
      }


      const unitPrice =
        Number(item.unitPrice);


      return {
        itemId: item.itemId,
        itemName: item.itemName,
        quantity,
        unitPrice,
        lineTotal:
          quantity * unitPrice
      };
    })
    .filter(Boolean);
}


function getCartTotal() {

  return getCartLines()
    .reduce(
      (sum, line) => {
        return (
          sum +
          line.lineTotal
        );
      },
      0
    );
}


function renderCart() {

  const cartLines =
    getCartLines();


  if (cartLines.length) {

    $("#cart").innerHTML =
      cartLines
        .map((line) => {
          return `
            <div class="line">
              <span>
                ${escapeHtml(line.itemName)}
                &times;
                ${line.quantity}
              </span>

              ${money(line.lineTotal)}
            </div>
          `;
        })
        .join("");

  } else {

    $("#cart").innerHTML = `
      <p class="meta">
        Tap an item to add it.
        Long-press to remove it.
      </p>
    `;
  }


  $("#total").textContent =
    money(
      getCartTotal()
    );


  updateCashChange();
  updateAvailableButton();
}


/* =========================================================
   CASH RECEIVED / CHANGE
   ========================================================= */

function updateCashChange() {

  const total =
    getCartTotal();

  const cashReceivedInput =
    $("#cashReceived");

  const cashReceived =
    Number(
      cashReceivedInput.value
    );


  if (
    total <= 0 ||
    cashReceivedInput.value.trim() === "" ||
    !isFinite(cashReceived) ||
    cashReceived < 0
  ) {

    $("#changeDue").textContent =
      money(0);

    $("#cash").disabled =
      true;

    $("#credit").disabled =
      false;

    return;
  }


  if (cashReceived < total) {

    $("#changeDue").textContent =
      money(0);

    $("#cash").disabled =
      true;

    $("#credit").disabled =
      false;

    return;
  }


  const change =
    cashReceived - total;


  $("#changeDue").textContent =
    money(change);

  $("#cash").disabled =
    false;

  $("#credit").disabled =
    true;
}


function resetCashReceived() {

  $("#cashReceived").value =
    "";

  $("#changeDue").textContent =
    money(0);

  $("#cash").disabled =
    true;
}


/* =========================================================
   CONFIRMATION DIALOG
   ========================================================= */

function ask(text, title = "Confirm") {

  return new Promise(
    (resolve) => {

      const dialog =
        $("#confirm");


      $("#ctitle").textContent =
        title;

      $("#ctext").innerHTML =
        text;


      dialog.returnValue =
        "";

      dialog.showModal();


      dialog.addEventListener(
        "close",
        () => {

          resolve(
            dialog.returnValue ===
              "yes"
          );
        },
        {
          once: true
        }
      );
    }
  );
}


/* =========================================================
   TRANSACTION ID
   ========================================================= */

function createTransactionId() {

  const date =
    new Date();


  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  const hour =
    String(
      date.getHours()
    ).padStart(2, "0");

  const minute =
    String(
      date.getMinutes()
    ).padStart(2, "0");

  const second =
    String(
      date.getSeconds()
    ).padStart(2, "0");

  const millisecond =
    String(
      date.getMilliseconds()
    ).padStart(3, "0");


  return (
    `ME-${year}${month}${day}-` +
    `${hour}${minute}${second}-` +
    `${millisecond}`
  );
}


/* =========================================================
   SAVE SALE
   ========================================================= */

function saveSaleToDatabase(paymentType) {

  return new Promise(
    (resolve, reject) => {

      const cartLines =
        getCartLines();

      const total =
        getCartTotal();


      if (!cartLines.length) {
        reject(
          new Error(
            "No items in this sale."
          )
        );

        return;
      }


      const transactionId =
        createTransactionId();


      const transactionDate =
        getTransactionLocalDate(
          transactionId
        );


      const shouldSetOldestLocalDate =
        !oldestLocalDate &&
        Boolean(transactionDate);


      /*
       * One IndexedDB transaction covers all three stores.
       *
       * Either the entire sale is saved, including inventory
       * changes, or none of it is saved.
       */

      const databaseTransaction =
        db.transaction(
          [
            ITEMS_STORE,
            TRANSACTIONS_STORE,
            TRANSACTION_ITEMS_STORE,
            META_STORE
          ],
          "readwrite"
        );

      const itemStore =
        databaseTransaction.objectStore(
          ITEMS_STORE
        );

      const transactionStore =
        databaseTransaction.objectStore(
          TRANSACTIONS_STORE
        );

      const transactionItemStore =
        databaseTransaction.objectStore(
          TRANSACTION_ITEMS_STORE
        );

      const metaStore =
        databaseTransaction.objectStore(
          META_STORE
        );
  
      transactionStore.add({
        transactionId,
        paymentType,
        total,
        archived: false
      });


      cartLines.forEach(
        (line) => {

          transactionItemStore.add({
            transactionId,
            itemId:
              line.itemId,

            itemName:
              line.itemName,

            quantity:
              line.quantity,

            unitPrice:
              line.unitPrice,

            paymentType
          });


          const item =
            items.find(
              (candidate) =>
                candidate.itemId ===
                line.itemId
            );


          if (item) {

            const updatedItem = {
              ...item,

              inventory:
                (
                  Number(
                    item.inventory
                  ) || 0
                ) -
                line.quantity
            };


            itemStore.put(
              updatedItem
            );
          }
        }
      );


      metaStore.put({
        key: "itemsDirty",
        value: true
      });


      if (shouldSetOldestLocalDate) {

        metaStore.put({
          key: "oldestLocalDate",
          value: transactionDate
        });
      }


      databaseTransaction.oncomplete =
        () => {

          if (shouldSetOldestLocalDate) {

            oldestLocalDate =
              transactionDate;
          }


          resolve(
            transactionId
          );
        };

      databaseTransaction.onerror =
        () => {

          reject(
            databaseTransaction.error
          );
        };


      databaseTransaction.onabort =
        () => {

          reject(
            databaseTransaction.error ||
            new Error(
              "Transaction was not saved."
            )
          );
        };
    }
  );
}

async function postSale(paymentType) {

  if (!getCartLines().length) {

    toast(
      "No items in this sale."
    );

    return false;
  }


  try {

    await saveSaleToDatabase(
      paymentType
    );


    cart = {};


    resetCashReceived();


    /*
     * Reload authoritative Items from IndexedDB.
     * This picks up the inventory changes made
     * as part of the sale.
     */

    await loadItems();


    renderCart();

/*
    toast(
      "Transaction saved."
    );
*/

    /*
     * Archive transactions to Google
     * in the background.
     *
     * Do not wait for Google.
     */

    archiveTransactions();

    return true;


  } catch (error) {

    console.error(
      "Unable to save transaction:",
      error
    );


    toast(
      "Transaction was not saved."
    );


    return false;
  }
}


/* =========================================================
   CASH CHECKOUT
   ========================================================= */

async function checkoutCash() {

  const total =
    getCartTotal();

  const cashReceived =
    Number(
      $("#cashReceived").value
    );


  if (
    total <= 0 ||
    !isFinite(cashReceived) ||
    cashReceived < total
  ) {

    updateCashChange();
    return;
  }


  const change =
    cashReceived - total;


  const confirmed =
    await ask(
      `Post <b>${money(total)}</b> Cash sale? Cash Received: ${money(cashReceived)} Change: <b>${money(change)}</b>`,
      "Cash Sale"
    );


  if (!confirmed) {
    return;
  }


  await postSale(
    "Cash"
  );
}


/* =========================================================
   CREDIT CHECKOUT
   ========================================================= */

async function checkoutCredit() {

  const cartLines =
    getCartLines();

  const total =
    getCartTotal();


  if (!cartLines.length) {

    toast(
      "No items in this sale."
    );

    return;
  }


  const confirmed =
    await ask(
      `Post <b>${money(total)}</b> Credit sale?`,
      "Credit Sale"
    );


  if (!confirmed) {
    return;
  }


  await postSale(
    "Credit"
  );
}


/* =========================================================
   POS EVENTS
   ========================================================= */

function initializePosEvents() {

  $("#cashReceived")
    .addEventListener(
      "input",
      updateCashChange
    );


  $("#cash").onclick =
    checkoutCash;


  $("#credit").onclick =
    checkoutCredit;


  $("#clear").onclick =
    async () => {

      /*
       * Nothing to clear.
       */

      if (!getCartLines().length) {
        return;
      }

/*
      const confirmed =
        await ask(
          "Clear all items from the current sale?",
          "Clear Sale"
        );

      if (!confirmed) {
        return;
      }
*/

      cart = {};

      resetCashReceived();

      renderProducts();
      renderCart();
    };
    
}


/* =========================================================
   ITEMS
   ========================================================= */

/* Load items from IndexedDB */
async function loadItems() {
  items =
    await getAllRecords(
      ITEMS_STORE
    );

  renderCategories();
  renderProducts();
  renderItems();
}

/* Generate next item ID */
async function getNextItemId() {

  const nextItemId =
    Number(
      await getMeta(
        "nextItemId",
        1
      )
    );


  await setMeta(
    "nextItemId",
    nextItemId + 1
  );


  return nextItemId;
}

/* Render items in the Items' list for display */
function renderItems() {
  const container =
    $("#itemList");

  if (!container) {
    return;
  }


  if (!items.length) {
    container.innerHTML =
      "<p>No items yet.</p>";

    return;
  }


  const sortedItems =
    items
      .slice()
      .sort((a, b) => {
        return (
          a.category.localeCompare(
            b.category
          ) ||
          (a.sort || 0) -
            (b.sort || 0)
        );
      });


  container.innerHTML =
    sortedItems
      .map((item) => {
        return `
          <div class="row">

            <div>

              <b>
                ${escapeHtml(
                  item.itemName
                )}
              </b>

              &mdash;
              ${money(
                item.unitPrice
              )}

              <div class="meta">

                ${escapeHtml(
                  item.category
                )}

                &bull;

                ${
                  item.active
                    ? "Active"
                    : "Inactive"
                }

                &bull; Inventory

                ${
                  Number(
                    item.inventory
                  ) || 0
                }

              </div>

            </div>


            <div class="actions">

              <button
                type="button"
                data-edit-item="${item.itemId}"
              >
                Edit
              </button>

              <button
                type="button"
                class="danger"
                data-delete-item="${item.itemId}"
              >
                Delete
              </button>

            </div>

          </div>
        `;
      })
      .join("");


  $$("[data-edit-item]").forEach(
    (button) => {

      button.onclick = () => {
        openItem(
          Number(
            button.dataset.editItem
          )
        );
      };
    }
  );


  $$("[data-delete-item]").forEach(
    (button) => {

      button.onclick = () => {
        removeItem(
          Number(
            button.dataset.deleteItem
          )
        );
      };
    }
  );
}

/* open item window to add/edit */
function openItem(itemId = null) {
  const dialog =
    $("#itemDlg");

  renderCategoryDropdown();
  
  const item =
    itemId === null
      ? null
      : items.find(
          (candidate) =>
            candidate.itemId === itemId
        );


  $("#itemTitle").textContent =
    item
      ? "Edit Item"
      : "Add Item";


  $("#iid").value =
    item
      ? item.itemId
      : "";


  $("#iname").value =
    item
      ? item.itemName
      : "";


  $("#icat").value =
    item
      ? item.category
      : "";


  $("#iprice").value =
    item
      ? item.unitPrice
      : "";


  $("#isort").value =
    item
      ? item.sort
      : 0;


  $("#iactive").checked =
    item
      ? item.active
      : true;


  $("#currentInventory").textContent =
    item
      ? Number(item.inventory) || 0
      : 0;


  $("#iaddinventory").value =
    0;


  dialog.showModal();
}

/* CATEGORY DROPDOWN */
function renderCategoryDropdown() {

  const categories = [
    ...new Set(
      items
        .map((item) =>
          String(
            item.category || ""
          ).trim()
        )
        .filter(Boolean)
    )
  ];


  $("#categoryDropdown").innerHTML =
    categories
      .map((category) => {
        return `
          <div
            class="category-dropdown-option"
            data-category="${escapeHtml(category)}"
          >
            ${escapeHtml(category)}
          </div>
        `;
      })
      .join("");


  $$(".category-dropdown-option")
    .forEach((option) => {

      option.onclick = () => {

        $("#icat").value =
          option.dataset.category;

        $("#categoryDropdown")
          .classList.remove("open");

        $("#icat").focus();
      };
    });
}

/* save item */
async function saveItem(event) {
  event.preventDefault();


  const existingId =
    $("#iid").value.trim();


  const existingItem =
    existingId
      ? items.find(
          (item) =>
            item.itemId ===
            Number(existingId)
        )
      : null;


  const addInventory =
    Number(
      $("#iaddinventory").value
    ) || 0;


  if (
    !Number.isInteger(
      addInventory
    )
  ) {
    toast(
      "Add Inventory must be a whole number."
    );

    return;
  }


  const item = {
    itemId:
      existingItem
        ? existingItem.itemId
        : await getNextItemId(),

    category:
      $("#icat").value.trim(),
    
    itemName:
      $("#iname").value.trim(),

    unitPrice:
      Number(
        $("#iprice").value
      ),

    active:
      $("#iactive").checked,

    sort:
      Number(
        $("#isort").value
      ) || 0,

    inventory:
      (
        existingItem
          ? Number(
              existingItem.inventory
            ) || 0
          : 0
      ) + addInventory
  };


  if (
    !item.itemName ||
    !item.category
  ) {
    toast(
      "Name and category are required."
    );

    return;
  }


  if (
    !Number.isFinite(
      item.unitPrice
    ) ||
    item.unitPrice < 0
  ) {
    toast(
      "Enter a valid price."
    );

    return;
  }

  await putRecord(
    ITEMS_STORE,
    item
  );

  await setMeta(
    "itemsDirty",
    true
  );

  $("#itemDlg").close();

  await loadItems();


  toast(
    existingItem
      ? "Item updated."
      : "Item added."
  );
}

/* delete item */
async function removeItem(itemId) {
  const item =
    items.find(
      (candidate) =>
        candidate.itemId === itemId
    );

  if (!item) {
    return;
  }


  const confirmed =
    await ask(
      `Delete <b>${escapeHtml(
        item.itemName
      )}</b>?`,
      "Delete Item"
    );


  if (!confirmed) {
    return;
  }


  await deleteRecord(
    ITEMS_STORE,
    itemId
  );

  await setMeta(
    "itemsDirty",
    true
  );

  await loadItems();


  toast(
    "Item deleted."
  );
}


/* =========================================================
   ITEM EVENTS
   ========================================================= */

function initializeItemEvents() {

  $("#add").onclick =
    () => {
      openItem();
    };


  $("#itemForm").addEventListener(
    "submit",
    saveItem
  );


  $$("#itemDlg .close").forEach(
    (button) => {

      button.onclick =
        () => {
          $("#itemDlg").close();
        };
    }
  );
  
  // category drop-down click events
  $("#categoryDropdownButton").onclick =
    () => {

      $("#categoryDropdown")
        .classList.toggle("open");

      $("#icat").focus();
    };


  $("#icat").addEventListener(
    "input",
    () => {

      $("#categoryDropdown")
        .classList.remove("open");
    }
  );


  document.addEventListener(
    "click",
    (event) => {

      if (
        !event.target.closest(
          ".category-combo"
        )
      ) {

        $("#categoryDropdown")
          .classList.remove("open");
      }
    }
  );
  
}


/* =========================================================
   TRANSACTIONS
   ========================================================= */

function getTodayLocalDate() {

  const today =
    new Date();


  return [
    today.getFullYear(),

    String(
      today.getMonth() + 1
    ).padStart(2, "0"),

    String(
      today.getDate()
    ).padStart(2, "0")
  ].join("-");
}


/*
 * Transaction IDs contain the local
 * date and time of the sale:
 *
 * ME-YYYYMMDD-HHMMSS-mmm
 */

function getTransactionDate(transactionId) {

  const match =
    String(
      transactionId
    ).match(
      /^ME-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})$/
    );


  if (!match) {
    return null;
  }


  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    Number(match[7])
  );
}

function getTransactionLocalDate(transactionId) {

  const date =
    getTransactionDate(
      transactionId
    );


  if (!date) {
    return "";
  }


  return [
    date.getFullYear(),

    String(
      date.getMonth() + 1
    ).padStart(2, "0"),

    String(
      date.getDate()
    ).padStart(2, "0")
  ].join("-");
}

function getPreviousLocalDate(localDate) {

  const parts =
    String(
      localDate || ""
    ).split("-");


  if (parts.length !== 3) {
    return "";
  }


  const date =
    new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );


  date.setDate(
    date.getDate() - 1
  );


  return [
    date.getFullYear(),

    String(
      date.getMonth() + 1
    ).padStart(2, "0"),

    String(
      date.getDate()
    ).padStart(2, "0")
  ].join("-");
}

function getLocalDateRange(
  dateTo,
  numberOfDays
) {

  const parts =
    String(
      dateTo || ""
    ).split("-");


  if (parts.length !== 3) {
    return {
      dateFrom: "",
      dateTo: ""
    };
  }


  const startDate =
    new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );


  /*
   * dateTo itself counts as one
   * of the requested days.
   */

  startDate.setDate(
    startDate.getDate() -
      (numberOfDays - 1)
  );


  const dateFrom = [
    startDate.getFullYear(),

    String(
      startDate.getMonth() + 1
    ).padStart(2, "0"),

    String(
      startDate.getDate()
    ).padStart(2, "0")
  ].join("-");


  return {
    dateFrom,
    dateTo
  };
}

async function importHistoricalTransactions(googleTransactions, googleTransactionItems, newOldestLocalDate, newLatestHistoricalDate) {

  const existingTransactions =
    await getAllRecords(
      TRANSACTIONS_STORE
    );


  const existingTransactionIds =
    new Set(
      existingTransactions.map(
        (transaction) =>
          transaction.transactionId
      )
    );


  /*
   * Local IndexedDB always wins.
   *
   * Only Google transactions that do
   * not already exist locally are
   * imported.
   */

  const transactionsToImport =
    googleTransactions.filter(
      (transaction) =>
        !existingTransactionIds.has(
          transaction.transactionId
        )
    );


  const importedTransactionIds =
    new Set(
      transactionsToImport.map(
        (transaction) =>
          transaction.transactionId
      )
    );


  /*
   * Import child rows only for parents
   * that are actually being imported.
   *
   * This prevents duplicate child rows
   * because transactionItems uses an
   * auto-increment rowId.
   */

  const transactionItemsToImport =
    googleTransactionItems.filter(
      (item) =>
        importedTransactionIds.has(
          item.transactionId
        )
    );


  await new Promise(
    (resolve, reject) => {

      const databaseTransaction =
        db.transaction(
          [
            TRANSACTIONS_STORE,
            TRANSACTION_ITEMS_STORE,
            META_STORE
          ],
          "readwrite"
        );


      const transactionStore =
        databaseTransaction.objectStore(
          TRANSACTIONS_STORE
        );


      const transactionItemStore =
        databaseTransaction.objectStore(
          TRANSACTION_ITEMS_STORE
        );


      const metaStore =
        databaseTransaction.objectStore(
          META_STORE
        );


      transactionsToImport.forEach(
        (transaction) => {

          transactionStore.add({
            transactionId:
              String(
                transaction.transactionId
              ),

            paymentType:
              String(
                transaction.paymentType ||
                ""
              ),

            total:
              Number(
                transaction.total
              ) || 0,

            /*
             * It came from Google,
             * therefore it is already
             * archived.
             */
            archived: true
          });
        }
      );


      transactionItemsToImport.forEach(
        (item) => {

          transactionItemStore.add({
            transactionId:
              String(
                item.transactionId
              ),

            itemId:
              Number(
                item.itemId
              ),

            itemName:
              String(
                item.itemName || ""
              ),

            quantity:
              Number(
                item.quantity
              ) || 0,

            unitPrice:
              Number(
                item.unitPrice
              ) || 0,

            paymentType:
              String(
                item.paymentType || ""
              )
          });
        }
      );


      /*
       * Move the local-history boundary
       * backward even if Google returned
       * no transactions for some or all
       * of the requested dates.
       */

      metaStore.put({
        key: "oldestLocalDate",
        value:
          newOldestLocalDate
      });


      /*
       * Save Google's latest known
       * transaction date.
       */

      metaStore.put({
        key: "latestHistoricalDate",
        value:
          newLatestHistoricalDate
      });


      databaseTransaction.oncomplete =
        () => {
          resolve();
        };


      databaseTransaction.onerror =
        () => {
          reject(
            databaseTransaction.error
          );
        };


      databaseTransaction.onabort =
        () => {
          reject(
            databaseTransaction.error ||
            new Error(
              "Historical transactions could not be imported."
            )
          );
        };
    }
  );


  /*
   * Keep the in-memory values in sync
   * only after the IndexedDB transaction
   * completed successfully.
   */

  oldestLocalDate =
    newOldestLocalDate;

  latestHistoricalDate =
    newLatestHistoricalDate;


  return {
    transactionsImported:
      transactionsToImport.length,

    transactionItemsImported:
      transactionItemsToImport.length
  };
}


/* =========================================================
   Bootstrap on a cold-start device to initialize IndexedDB and oldestLocalDate
   ========================================================= */

async function bootstrapTransactionHistory() {

  /*
   * This is needed only on a new device
   * whose local transaction-history
   * boundary has not yet been established.
   */

  if (oldestLocalDate) {
    return true;
  }


  /*
   * Search Google backward in consecutive
   * 30-day blocks until we find at least
   * one transaction.
   *
   * Once a block containing transactions
   * is found, that block and every newer
   * block have been checked, so local
   * history is known complete from the
   * beginning of that block through today.
   */

  let dateTo =
    getTodayLocalDate();


  try {

    while (true) {

      const {
        dateFrom
      } =
        getLocalDateRange(
          dateTo,
          30
        );


      console.log(
        `Cold-start history check ${dateFrom} through ${dateTo}.`
      );


      const result =
        await googleRequest(
          "getTransactions",
          {
            dateFrom,
            dateTo
          }
        );


      const googleTransactions =
        Array.isArray(
          result.transactions
        )
          ? result.transactions
          : [];


      const googleTransactionItems =
        Array.isArray(
          result.transactionItems
        )
          ? result.transactionItems
          : [];


      /*
       * The backend reports this from the
       * entire Google Transactions sheet.
       *
       * Blank therefore means Google has
       * no transaction history at all.
       */

      const reportedLatestDate =
        String(
          result.latestHistoricalDate ||
          ""
        );


      if (!reportedLatestDate) {

        console.log(
          "Google transaction history is empty."
        );

        return true;
      }


      /*
       * We found historical transactions.
       *
       * Import them and establish the local
       * completeness boundary at the start
       * of this successfully checked block.
       */

      if (googleTransactions.length) {

        await importHistoricalTransactions(
          googleTransactions,
          googleTransactionItems,
          dateFrom,
          reportedLatestDate
        );


        console.log(
          `Cold-start transaction history initialized from ${dateFrom}.`
        );


        return true;
      }


      /*
       * Google contains transactions, but
       * not in this 30-day block.
       *
       * Continue with the immediately
       * preceding 30-day block.
       */

      dateTo =
        getPreviousLocalDate(
          dateFrom
        );
    }


  } catch (error) {

    /*
     * Google being unavailable must not
     * prevent the POS from starting.
     *
     * Leave oldestLocalDate blank so a
     * future startup can try again.
     */

    console.error(
      "Unable to initialize transaction history:",
      error
    );


    return false;
  }
}


/* =========================================================
   BACKGROUND TRANSACTION PRUNING
   ========================================================= */

async function pruneOldLocalTransactions() {

  /*
   * Keep the most recent 30 calendar
   * days of transaction history locally.
   */

  const {
    dateFrom: keepFromDate
  } =
    getLocalDateRange(
      getTodayLocalDate(),
      30
    );

console.log(
  `Pruning check: keeping transactions from ${keepFromDate} through today.`
);

  if (!keepFromDate) {
    return;
  }


  const localTransactions =
    await getAllRecords(
      TRANSACTIONS_STORE
    );

console.log(
  `Pruning check: ${localTransactions.length} local transaction(s) found.`
);

  /*
   * Never prune across an old transaction
   * that has not yet been archived.
   *
   * This keeps oldestLocalDate truthful:
   * everything before the boundary must
   * already exist in Google.
   */

  const hasOldUnarchivedTransaction =
    localTransactions.some(
      (transaction) => {

        const localDate =
          getTransactionLocalDate(
            transaction.transactionId
          );


        return (
          localDate &&
          localDate < keepFromDate &&
          transaction.archived !== true
        );
      }
    );


  if (hasOldUnarchivedTransaction) {

    console.log(
      "Transaction pruning skipped because older unarchived transactions remain."
    );

    return;
  }


  const transactionsToPrune =
    localTransactions.filter(
      (transaction) => {

        const localDate =
          getTransactionLocalDate(
            transaction.transactionId
          );


        return (
          localDate &&
          localDate < keepFromDate &&
          transaction.archived === true
        );
      }
    );


  /*
   * Nothing needs deleting, but the
   * completeness boundary may still be
   * older than our current retention
   * window.
   */

  if (!transactionsToPrune.length) {

    if (
      oldestLocalDate &&
      oldestLocalDate < keepFromDate
    ) {

      await setMeta(
        "oldestLocalDate",
        keepFromDate
      );

      oldestLocalDate =
        keepFromDate;
    }


    return;
  }


  const transactionIdsToPrune =
    new Set(
      transactionsToPrune.map(
        (transaction) =>
          transaction.transactionId
      )
    );


  await new Promise(
    (resolve, reject) => {

      const databaseTransaction =
        db.transaction(
          [
            TRANSACTIONS_STORE,
            TRANSACTION_ITEMS_STORE,
            META_STORE
          ],
          "readwrite"
        );


      const transactionStore =
        databaseTransaction.objectStore(
          TRANSACTIONS_STORE
        );


      const transactionItemStore =
        databaseTransaction.objectStore(
          TRANSACTION_ITEMS_STORE
        );


      const transactionItemIndex =
        transactionItemStore.index(
          "transactionId"
        );


      const metaStore =
        databaseTransaction.objectStore(
          META_STORE
        );


      transactionsToPrune.forEach(
        (transaction) => {

          transactionStore.delete(
            transaction.transactionId
          );


          const request =
            transactionItemIndex.openCursor(
              IDBKeyRange.only(
                transaction.transactionId
              )
            );


          request.onsuccess =
            () => {

              const cursor =
                request.result;


              if (!cursor) {
                return;
              }


              cursor.delete();
              cursor.continue();
            };
        }
      );


      /*
       * Local history is now known complete
       * from the beginning of the retained
       * 30-day window through today.
       */

      metaStore.put({
        key: "oldestLocalDate",
        value: keepFromDate
      });


      databaseTransaction.oncomplete =
        () => {

          oldestLocalDate =
            keepFromDate;


          console.log(
            `${transactionIdsToPrune.size} old transaction(s) pruned from IndexedDB.`
          );


          resolve();
        };


      databaseTransaction.onerror =
        () => {

          reject(
            databaseTransaction.error
          );
        };


      databaseTransaction.onabort =
        () => {

          reject(
            databaseTransaction.error ||
            new Error(
              "Transaction pruning failed."
            )
          );
        };
    }
  );
}

 
async function ensureTransactionHistory(requestedFrom) {

  requestedFrom =
    String(
      requestedFrom || ""
    );


  /*
   * No starting date means there is no
   * bounded historical range to fetch.
   */

  if (!requestedFrom) {
    return true;
  }


  /*
   * If this date is already inside our
   * known-complete local history, there
   * is nothing to fetch.
   */

  if (
    oldestLocalDate &&
    requestedFrom >=
      oldestLocalDate
  ) {

    return true;
  }


  /*
   * We need history older than our
   * current local boundary.
   *
   * If Google's latest known transaction
   * is already older than the requested
   * starting date, there is still no
   * reason to fetch Google.
   *
   * Example:
   *
   * Google latest:  2026-09-10
   * Local complete: 2026-09-20
   * Requested from: 2026-09-15
   *
   * Google cannot contain anything in
   * the missing 9/15-9/19 interval.
   */

  if (
    latestHistoricalDate &&
    latestHistoricalDate <
      requestedFrom
  ) {

    return true;
  }


  /*
   * Fetch only the portion not already
   * known to be complete locally.
   */

  const googleDateTo =
    oldestLocalDate
      ? getPreviousLocalDate(
          oldestLocalDate
        )
      : requestedFrom;


  /*
   * If we already know Google's latest
   * transaction is earlier than the
   * local boundary, there is no reason
   * to ask beyond that date.
   */

  const fetchDateTo =
    latestHistoricalDate &&
    latestHistoricalDate <
      googleDateTo
      ? latestHistoricalDate
      : googleDateTo;


  /*
   * Nothing in Google can fall inside
   * the missing interval.
   */

  if (
    fetchDateTo <
      requestedFrom
  ) {

    return true;
  }


  try {

    const result =
      await googleRequest(
        "getTransactions",
        {
          dateFrom:
            requestedFrom,

          dateTo:
            fetchDateTo
        }
      );


    const googleTransactions =
      Array.isArray(
        result.transactions
      )
        ? result.transactions
        : [];


    const googleTransactionItems =
      Array.isArray(
        result.transactionItems
      )
        ? result.transactionItems
        : [];


    /*
     * The backend reports this from the
     * entire Google Transactions sheet,
     * not merely from this requested
     * range.
     */

    const reportedLatestDate =
      String(
        result.latestHistoricalDate ||
        ""
      );


    await importHistoricalTransactions(
      googleTransactions,
      googleTransactionItems,

      /*
       * A successful Google request means
       * the local history is now known
       * complete back through the
       * requested date, even when Google
       * returned zero rows.
       */
      requestedFrom,

      reportedLatestDate
    );


    console.log(
      `Historical transactions checked ${requestedFrom} through ${fetchDateTo}.`
    );


    return true;

  } catch (error) {

    console.error(
      "Unable to load transaction history:",
      error
    );


    toast(
      "Unable to load transaction history."
    );


    return false;
  }
}

async function loadTransactions() {

  transactions =
    await getAllRecords(
      TRANSACTIONS_STORE
    );


  transactionItems =
    await getAllRecords(
      TRANSACTION_ITEMS_STORE
    );


  /*
   * Newest transaction first.
   */

  transactions.sort(
    (a, b) =>
      b.transactionId.localeCompare(
        a.transactionId
      )
  );


  renderItemFilter();
  renderTransactions();
}

async function loadTransactionHistory() {

  const dateFrom =
    $("#dateFrom").value;


  /*
   * Only show Updating... when the
   * requested date reaches farther back
   * than our known-complete local
   * history and Google may be needed.
   */

  const mayNeedGoogle =
    dateFrom &&
    (
      !oldestLocalDate ||
      dateFrom < oldestLocalDate
    ) &&
    (
      !latestHistoricalDate ||
      dateFrom <= latestHistoricalDate
    );


  if (mayNeedGoogle) {

    $("#transactionHistoryStatus")
      .textContent =
        "Updating...";

    $("#dateFrom").disabled =
      true;

    $("#dateTo").disabled =
      true;
        
  }


  const historyReady =
    await ensureTransactionHistory(
      dateFrom
    );


  if (!historyReady) {

    $("#transactionHistoryStatus")
      .textContent = "";

    $("#dateFrom").disabled =
      false;

    $("#dateTo").disabled =
      false;
      
    return;
  }


  await loadTransactions();


  $("#transactionHistoryStatus")
    .textContent = "";
    
  $("#dateFrom").disabled =
    false;

  $("#dateTo").disabled =
    false;
    
}

function getSelectedItemIds() {

  return $$(
    "#itemFilterMenu input[data-filter-type='item']:checked"
  ).map(
    (checkbox) =>
      Number(
        checkbox.value
      )
  );
}

/* Transactions listing filters */
function updateCategoryFilterState(category) {

  const categoryCheckbox =
    $(
      `#itemFilterMenu input[data-filter-type="category"][data-category="${CSS.escape(category)}"]`
    );


  if (!categoryCheckbox) {
    return;
  }


  const itemCheckboxes =
    $$(
      `#itemFilterMenu input[data-filter-type="item"][data-category="${CSS.escape(category)}"]`
    );


  const checkedCount =
    itemCheckboxes.filter(
      (checkbox) =>
        checkbox.checked
    ).length;


  categoryCheckbox.checked =
    itemCheckboxes.length > 0 &&
    checkedCount ===
      itemCheckboxes.length;


  categoryCheckbox.indeterminate =
    checkedCount > 0 &&
    checkedCount <
      itemCheckboxes.length;
}

/* Filter the transactions and display it in the list */
function renderItemFilter() {

  const menu =
    $("#itemFilterMenu");

  const summary =
    $("#itemFilter summary");


  const filterItems =
    items
      .slice()
      .sort((a, b) => {

        return (
          a.category.localeCompare(
            b.category
          ) ||
          Number(a.sort || 0) -
          Number(b.sort || 0)
        );
      });


  const categories = [
    ...new Set(
      filterItems.map(
        (item) =>
          item.category ||
          "Other"
      )
    )
  ];


  menu.innerHTML = `
    <label class="item-filter-category">
      <input
        type="checkbox"
        id="allItemsFilter"
      >
      All Items
    </label>
  ` +
    categories
      .map((category) => {

        const categoryItems =
          filterItems.filter(
            (item) =>
              (
                item.category ||
                "Other"
              ) === category
          );


        return `
          <label class="item-filter-category">
            <input
              type="checkbox"
              data-filter-type="category"
              data-category="${escapeHtml(category)}"
            >
            ${escapeHtml(category)}
          </label>

          ${categoryItems
            .map((item) => {

              return `
                <label class="item-filter-item">
                  <input
                    type="checkbox"
                    value="${item.itemId}"
                    data-filter-type="item"
                    data-category="${escapeHtml(category)}"
                  >
                  ${escapeHtml(
                    item.itemName
                  )}
                </label>
              `;
            })
            .join("")}
        `;
      })
      .join("");


  summary.textContent =
    "All Transactions";


  $$(
    '#itemFilterMenu input[data-filter-type="category"]'
  ).forEach((checkbox) => {

    checkbox.onchange = () => {

      const category =
        checkbox.dataset.category;


      $$(
        '#itemFilterMenu input[data-filter-type="item"]'
      )
        .filter(
          (itemCheckbox) =>
            itemCheckbox.dataset.category ===
            category
        )
        .forEach(
          (itemCheckbox) => {

            itemCheckbox.checked =
              checkbox.checked;
          }
        );


      const itemCheckboxes =
        $$(
          '#itemFilterMenu input[data-filter-type="item"]'
        );


      $("#allItemsFilter").checked =
        itemCheckboxes.length > 0 &&
        itemCheckboxes.every(
          (itemCheckbox) =>
            itemCheckbox.checked
        );


      renderTransactions();
    };
  });


  $$(
    '#itemFilterMenu input[data-filter-type="item"]'
  ).forEach((checkbox) => {

    checkbox.onchange = () => {

      updateCategoryFilterState(
        checkbox.dataset.category
      );


      const itemCheckboxes =
        $$(
          '#itemFilterMenu input[data-filter-type="item"]'
        );


      $("#allItemsFilter").checked =
        itemCheckboxes.length > 0 &&
        itemCheckboxes.every(
          (itemCheckbox) =>
            itemCheckbox.checked
        );


      renderTransactions();
    };
  });


  $("#allItemsFilter").onchange =
    () => {

      const checked =
        $("#allItemsFilter")
          .checked;


      $$(
        '#itemFilterMenu input[data-filter-type="item"]'
      ).forEach((checkbox) => {

        checkbox.checked =
          checked;
      });


      $$(
        '#itemFilterMenu input[data-filter-type="category"]'
      ).forEach((checkbox) => {

        checkbox.checked =
          checked;

        checkbox.indeterminate =
          false;
      });


      renderTransactions();
    };
}

function renderTransactions() {

  const dateFrom =
    $("#dateFrom").value;

  const dateTo =
    $("#dateTo").value;

  const selectedPayment =
    $("#payment").value;

  const selectedItemIds =
    getSelectedItemIds();


  const allItemCheckboxes =
    $$(
      "#itemFilterMenu input[data-filter-type='item']"
    );


  $("#itemFilter summary").textContent =
    !selectedItemIds.length
      ? "All Transactions"
      : (
          allItemCheckboxes.length > 0 &&
          selectedItemIds.length ===
            allItemCheckboxes.length
        )
        ? "All Items"
        : `${selectedItemIds.length} selected`;


  /*
   * ITEM MODE
   */

  if (selectedItemIds.length) {

    const filteredItems =
      transactionItems.filter(
        (item) => {

          const localDate =
            getTransactionLocalDate(
              item.transactionId
            );


          let matchesDate =
            true;


          if (
            dateFrom &&
            dateTo
          ) {

            matchesDate =
              localDate >= dateFrom &&
              localDate <= dateTo;

          } else if (dateFrom) {

            matchesDate =
              localDate === dateFrom;

          } else if (dateTo) {

            matchesDate =
              localDate === dateTo;
          }


          const matchesPayment =
            !selectedPayment ||
            item.paymentType ===
              selectedPayment;


          const matchesItem =
            selectedItemIds.includes(
              Number(item.itemId)
            );


          return (
            matchesDate &&
            matchesPayment &&
            matchesItem
          );
        }
      );


    const itemCount =
      filteredItems.reduce(
        (sum, item) =>
          sum +
          Number(
            item.quantity || 0
          ),
        0
      );


    const itemTotal =
      filteredItems.reduce(
        (sum, item) =>
          sum +
          (
            Number(
              item.quantity || 0
            ) *
            Number(
              item.unitPrice || 0
            )
          ),
        0
      );


    $("#countLabel").textContent =
      "Items";

    $("#transactionCount").textContent =
      itemCount;

    $("#transactionTotal").textContent =
      money(itemTotal);


    if (!filteredItems.length) {

      $("#txList").innerHTML =
        "<p>No matching items.</p>";

      return;
    }


    const itemGroups =
      new Map();


    filteredItems.forEach(
      (item) => {

        const itemId =
          Number(item.itemId);


        if (!itemGroups.has(itemId)) {

          itemGroups.set(
            itemId,
            {
              itemId:
                item.itemId,

              itemName:
                item.itemName,

              quantity: 0,
              total: 0,
              sales: []
            }
          );
        }


        const group =
          itemGroups.get(
            itemId
          );


        group.quantity +=
          Number(
            item.quantity || 0
          );


        group.total +=
          Number(
            item.quantity || 0
          ) *
          Number(
            item.unitPrice || 0
          );


        group.sales.push(
          item
        );
      }
    );


    $("#txList").innerHTML =
      [...itemGroups.values()]
        .map((group) => {

          const saleLines =
            group.sales
              .slice()
              .sort(
                (a, b) =>
                  b.transactionId.localeCompare(
                    a.transactionId
                  )
              )
              .map((item) => {

                const date =
                  getTransactionDate(
                    item.transactionId
                  );


                return `
                  <div class="item-sale-detail">

                    <span class="item-sale-date">
                      ${
                        date
                          ? date.toLocaleString()
                          : ""
                      }
                    </span>

                    <span class="item-sale-payment">
                      ${escapeHtml(
                        item.paymentType
                      )}
                    </span>

                    <span class="item-sale-price">
                      ${money(
                        item.unitPrice
                      )} each
                    </span>

                    <span class="item-sale-quantity">
                      ${item.quantity} sold
                    </span>

                    <span class="item-sale-total">
                      ${money(
                        Number(
                          item.unitPrice
                        ) *
                        Number(
                          item.quantity
                        )
                      )}
                    </span>

                    <span class="item-sale-id">
                      ${escapeHtml(
                        item.transactionId
                      )}
                    </span>

                  </div>
                `;
              })
              .join("");


          return `
            <div class="row">

              <div>

                <b>
                  ${escapeHtml(
                    group.itemName
                  )}
                  &bull; Quantity
                  ${group.quantity}
                  &bull; Total
                  ${money(
                    group.total
                  )}
                </b>

                <div class="txitems">
                  ${saleLines}
                </div>

              </div>

            </div>
          `;
        })
        .join("");


    return;
  }


  /*
   * TRANSACTION MODE
   */

  $("#countLabel").textContent =
    "Transactions";


  const filteredTransactions =
    transactions.filter(
      (transaction) => {

        const localDate =
          getTransactionLocalDate(
            transaction.transactionId
          );


        let matchesDate =
          true;


        if (
          dateFrom &&
          dateTo
        ) {

          matchesDate =
            localDate >= dateFrom &&
            localDate <= dateTo;

        } else if (dateFrom) {

          matchesDate =
            localDate === dateFrom;

        } else if (dateTo) {

          matchesDate =
            localDate === dateTo;
        }


        const matchesPayment =
          !selectedPayment ||
          transaction.paymentType ===
            selectedPayment;


        return (
          matchesDate &&
          matchesPayment
        );
      }
    );


  $("#transactionCount").textContent =
    filteredTransactions.length;


  const transactionTotal =
    filteredTransactions.reduce(
      (sum, transaction) =>
        sum +
        Number(
          transaction.total || 0
        ),
      0
    );


  $("#transactionTotal").textContent =
    money(
      transactionTotal
    );


  if (!filteredTransactions.length) {

    $("#txList").innerHTML =
      "<p>No matching transactions.</p>";

    return;
  }


  $("#txList").innerHTML =
    filteredTransactions
      .map((transaction) => {

        const lines =
          transactionItems.filter(
            (item) =>
              item.transactionId ===
              transaction.transactionId
          );


        const itemLines =
          lines
            .map((item) => {

              return `
                <div class="transaction-item-detail">

                  <span class="transaction-item-name">
                    ${escapeHtml(
                      item.itemName
                    )}
                  </span>

                  <span class="transaction-item-price">
                    ${money(
                      item.unitPrice
                    )} each
                  </span>

                  <span class="transaction-item-quantity">
                    ${item.quantity} sold
                  </span>

                  <span class="transaction-item-total">
                    ${money(
                      Number(
                        item.unitPrice
                      ) *
                      Number(
                        item.quantity
                      )
                    )}
                  </span>

                </div>
              `;
            })
            .join("");


        const date =
          getTransactionDate(
            transaction.transactionId
          );


        return `
          <div class="row">

            <div>

              <b>
                ${money(
                  transaction.total
                )}
                &bull;
                ${escapeHtml(
                  transaction.paymentType
                )}
              </b>

              <div class="meta">

                <span class="transaction-date">
                  ${
                    date
                      ? date.toLocaleString()
                      : ""
                  }
                </span>

                <span class="transaction-id">
                  &bull;

                  ${escapeHtml(
                    transaction.transactionId
                  )}
                </span>

              </div>

              <div class="txitems">
                ${itemLines}
              </div>

            </div>


            <div>

              <button
                class="danger deltx"
                data-id="${escapeHtml(
                  transaction.transactionId
                )}"
              >
                Delete
              </button>

            </div>

          </div>
        `;
      })
      .join("");


  $$(".deltx").forEach(
    (button) => {

      button.onclick = () => {

        deleteTransaction(
          button.dataset.id
        );
      };
    }
  );
}

async function deleteTransaction(transactionId) {

  const transaction =
    transactions.find(
      (candidate) =>
        candidate.transactionId ===
        transactionId
    );


  if (!transaction) {
    return;
  }

/*
  const confirmed =
    await ask(
      `Delete ${escapeHtml(
        transactionId
      )} for <b>${money(
        transaction.total
      )}</b>?`,
      "Delete Transaction"
    );
*/

  const date =
    getTransactionDate(
      transactionId
    );
  
  const confirmed =
    await ask(
      `
        <b>${escapeHtml(
          transactionId
        )}</b><br><br>

        ${date
          ? escapeHtml(
              date.toLocaleString()
            )
          : ""
        }<br>

        ${money(
          transaction.total
        )}
        
        &bull;

        ${escapeHtml(
          transaction.paymentType
        )}
        <br><br>

        Delete this transaction?
      `,
      "Delete Transaction"
    );
    
  if (!confirmed) {
    return;
  }

  $("#status").textContent = "Deleting transaction...";

  /*
   * An archived transaction has already
   * been written to Google.
   *
   * Delete the Google copy first. Only
   * continue with the local deletion
   * after Google confirms that the
   * transaction is absent there.
   */

  if (transaction.archived) {

    try {

      const result =
        await googleRequest(
          "deleteTransactions",
          {
            transactionIds: [
              transactionId
            ]
          }
        );


      const deletedIds =
        Array.isArray(
          result.deletedTransactionIds
        )
          ? result.deletedTransactionIds
          : [];


      if (
        !deletedIds.includes(
          transactionId
        )
      ) {

        throw new Error(
          "Google did not confirm transaction deletion."
        );
      }


    } catch (error) {

      console.error(
        "Unable to delete archived transaction from Google:",
        error
      );

      $("#status").textContent = "Online";
      
      toast(
        "Transaction could not be deleted."
      );

      return;
    }
  }


  const matchingLines =
    transactionItems.filter(
      (item) =>
        item.transactionId ===
        transactionId
    );


  try {

    await new Promise(
      (resolve, reject) => {

        const databaseTransaction =
          db.transaction(
            [
              ITEMS_STORE,
              TRANSACTIONS_STORE,
              TRANSACTION_ITEMS_STORE,
              META_STORE
            ],
            "readwrite"
          );


        const itemStore =
          databaseTransaction.objectStore(
            ITEMS_STORE
          );


        const transactionStore =
          databaseTransaction.objectStore(
            TRANSACTIONS_STORE
          );


        const transactionItemStore =
          databaseTransaction.objectStore(
            TRANSACTION_ITEMS_STORE
          );


        const metaStore =
          databaseTransaction.objectStore(
            META_STORE
          );


        transactionStore.delete(
          transactionId
        );


        matchingLines.forEach(
          (line) => {

            transactionItemStore.delete(
              line.rowId
            );
          }
        );


        /*
         * Undo the inventory effect
         * of the deleted sale.
         */

        matchingLines.forEach(
          (line) => {

            const item =
              items.find(
                (candidate) =>
                  candidate.itemId ===
                  Number(line.itemId)
              );


            /*
             * The item may have been
             * deleted since the sale.
             * Do not recreate it.
             */

            if (!item) {
              return;
            }


            itemStore.put({
              ...item,

              inventory:
                (
                  Number(
                    item.inventory
                  ) || 0
                ) +
                Number(
                  line.quantity || 0
                )
            });
          }
        );


        /*
         * Inventory changed, so the
         * Items backup in Google will
         * eventually need updating.
         */

        metaStore.put({
          key: "itemsDirty",
          value: true
        });


        databaseTransaction.oncomplete =
          () => {
            resolve();
          };


        databaseTransaction.onerror =
          () => {
            reject(
              databaseTransaction.error
            );
          };


        databaseTransaction.onabort =
          () => {
            reject(
              databaseTransaction.error ||
              new Error(
                "Transaction could not be deleted."
              )
            );
          };
      }
    );


    await loadItems();
    await loadTransactions();


    //toast(
    //  "Transaction deleted."
    //);

  } catch (error) {

    console.error(
      "Unable to delete transaction:",
      error
    );

    toast(
      "Transaction could not be deleted."
    );

  } finally {

    $("#status").textContent = "Online";

  }
}

function initializeTransactionEvents() {

  $("#dateFrom").addEventListener(
    "change",
    loadTransactionHistory
  );


  $("#dateTo").addEventListener(
    "change",
    loadTransactionHistory
  );


  $$("#paymentFilterMenu button")
    .forEach((button) => {

      button.onclick =
        () => {

          const payment =
            button.dataset.payment;


          /*
           * Store the selected value where
           * the existing transaction filter
           * already expects to find it.
           */

          $("#payment").value =
            payment;


          /*
           * Show the current selection in
           * the custom drop-down heading.
           */

          $("#paymentFilter summary")
            .textContent =
              payment ||
              "All Payments";


          /*
           * Close the menu after choosing.
           */

          $("#paymentFilter").open =
            false;


          renderTransactions();
        };
    });


  $("#clearFilters").onclick =
    () => {

      const today =
        getTodayLocalDate();


      $("#dateFrom").value =
        today;

      $("#dateTo").value =
        today;

      $("#payment").value =
        "";

      $("#paymentFilter summary")
        .textContent =
          "All Payments";


      renderItemFilter();
      loadTransactionHistory();
    };
    
    document.addEventListener(
      "click",
      (event) => {

        if (
          !event.target.closest(
            "#itemFilter"
          )
        ) {
          $("#itemFilter").open =
            false;
        }


        if (
          !event.target.closest(
            "#paymentFilter"
          )
        ) {
          $("#paymentFilter").open =
            false;
        }
      }
    );
    
}


/* =========================================================
   SUMMARY
   ========================================================= */

async function loadSummary() {

  /*
   * Today and Event use IndexedDB.
   *
   * Month and YTD combine:
   *
   *   Google aggregate data for dates
   *   older than our known-complete
   *   local history,
   *
   *   plus IndexedDB for the portion
   *   known to be complete locally.
   *
   * The two ranges never overlap.
   */

  const summaryTransactions =
    await getAllRecords(
      TRANSACTIONS_STORE
    );


  const summaryItems =
    await getAllRecords(
      TRANSACTION_ITEMS_STORE
    );


  const now =
    new Date();


  const todayStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );


  const tomorrowStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );


  const monthStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );


  const yearStart =
    new Date(
      now.getFullYear(),
      0,
      1
    );


  /*
   * EVENT
   *
   * Monday - Friday:
   *
   *   Use today's transactions if there
   *   are any.
   *
   *   Otherwise look backward through
   *   the current Monday-Friday period
   *   for the most recent day that has
   *   transactions.
   *
   *   If no weekday in the current
   *   Monday-Friday period has
   *   transactions, use the immediately
   *   preceding weekend event.
   *
   * Saturday / Sunday:
   *
   *   Use the current Friday-Sunday
   *   weekend event.
   *
   * Weekend labels are based on the
   * first and last days that actually
   * contain transactions.
   *
   * If no applicable event contains
   * transactions, display "-".
   */

  let eventStart = null;
  let eventEnd = null;
  let eventLabel = "-";


  const dayOfWeek =
    now.getDay();


  const dayNames = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat"
  ];


  /*
   * Does a particular calendar day
   * contain at least one transaction?
   */

  function hasTransactionsOnDay(
    dayStart
  ) {

    const nextDay =
      new Date(
        dayStart.getFullYear(),
        dayStart.getMonth(),
        dayStart.getDate() + 1
      );


    return summaryTransactions.some(
      (transaction) => {

        const date =
          getTransactionDate(
            transaction.transactionId
          );


        return (
          date &&
          date >= dayStart &&
          date < nextDay
        );
      }
    );
  }


  /*
   * Find a weekend event.
   *
   * fridayStart must be the Friday
   * beginning that weekend.
   */

  function findWeekendEvent(
    fridayStart,
    lastAllowedDay
  ) {

    const activeDays = [];


    for (
      let offset = 0;
      offset <= 2;
      offset++
    ) {

      const dayStart =
        new Date(
          fridayStart.getFullYear(),
          fridayStart.getMonth(),
          fridayStart.getDate() + offset
        );


      /*
       * Do not look beyond today when
       * examining the current weekend.
       */

      if (
        lastAllowedDay &&
        dayStart > lastAllowedDay
      ) {
        break;
      }


      if (
        hasTransactionsOnDay(
          dayStart
        )
      ) {

        activeDays.push(
          dayStart
        );
      }
    }


    if (!activeDays.length) {
      return null;
    }


    const firstDay =
      activeDays[0];


    const lastDay =
      activeDays[
        activeDays.length - 1
      ];


    const end =
      new Date(
        lastDay.getFullYear(),
        lastDay.getMonth(),
        lastDay.getDate() + 1
      );


    const firstName =
      dayNames[
        firstDay.getDay()
      ];


    const lastName =
      dayNames[
        lastDay.getDay()
      ];


    return {

      start:
        firstDay,

      end,

      label:
        firstName === lastName
          ? firstName
          : `${firstName} to ${lastName}`
    };
  }


  /*
   * Monday - Friday
   */

  if (
    dayOfWeek >= 1 &&
    dayOfWeek <= 5
  ) {

    /*
     * Find Monday of the current week.
     */

    const mondayStart =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() -
          (dayOfWeek - 1)
      );


    /*
     * Search backward from today
     * through Monday.
     */

    for (
      let offset =
        dayOfWeek - 1;

      offset >= 0;
      offset--
    ) {

      const candidateDay =
        new Date(
          mondayStart.getFullYear(),
          mondayStart.getMonth(),
          mondayStart.getDate() +
            offset
        );


      if (
        hasTransactionsOnDay(
          candidateDay
        )
      ) {

        eventStart =
          candidateDay;


        eventEnd =
          new Date(
            candidateDay.getFullYear(),
            candidateDay.getMonth(),
            candidateDay.getDate() + 1
          );


        eventLabel =
          dayNames[
            candidateDay.getDay()
          ];


        break;
      }
    }


    /*
     * No transactions Monday through
     * today.
     *
     * Fall back to the immediately
     * preceding Friday-Sunday weekend.
     */

    if (!eventStart) {

      const previousFriday =
        new Date(
          mondayStart.getFullYear(),
          mondayStart.getMonth(),
          mondayStart.getDate() - 3
        );


      const weekendEvent =
        findWeekendEvent(
          previousFriday,
          null
        );


      if (weekendEvent) {

        eventStart =
          weekendEvent.start;

        eventEnd =
          weekendEvent.end;

        eventLabel =
          weekendEvent.label;
      }
    }


  /*
   * Saturday / Sunday
   */

  } else {

    const daysSinceFriday =
      dayOfWeek === 6
        ? 1
        : 2;


    const fridayStart =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() -
          daysSinceFriday
      );


    const weekendEvent =
      findWeekendEvent(
        fridayStart,
        todayStart
      );


    if (weekendEvent) {

      eventStart =
        weekendEvent.start;

      eventEnd =
        weekendEvent.end;

      eventLabel =
        weekendEvent.label;
    }
  }


  $("#summaryEventDays")
    .textContent =
      eventLabel;
    


  /*
   * Calculate one summary period.
   */

  function calculateSummary(
    start,
    end
  ) {

    const matchingTransactions =
      summaryTransactions.filter(
        (transaction) => {

          const date =
            getTransactionDate(
              transaction.transactionId
            );


          return (
            date &&
            date >= start &&
            date < end
          );
        }
      );


    const matchingItems =
      summaryItems.filter(
        (item) => {

          const date =
            getTransactionDate(
              item.transactionId
            );


          return (
            date &&
            date >= start &&
            date < end
          );
        }
      );


    return {

      amount:
        matchingTransactions.reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.total || 0
            ),
          0
        ),

      transactions:
        matchingTransactions.length,

      items:
        matchingItems.reduce(
          (sum, item) =>
            sum +
            Number(
              item.quantity || 0
            ),
          0
        )
    };
  }


  /*
   * Convert a local Date object into
   * YYYY-MM-DD without UTC conversion.
   */

  function formatLocalDate(date) {

    return [
      date.getFullYear(),

      String(
        date.getMonth() + 1
      ).padStart(2, "0"),

      String(
        date.getDate()
      ).padStart(2, "0")
    ].join("-");
  }


  /*
   * Add two summary objects together.
   */

  function combineSummary(
    first,
    second
  ) {

    return {
      amount:
        Number(first.amount || 0) +
        Number(second.amount || 0),

      transactions:
        Number(first.transactions || 0) +
        Number(second.transactions || 0),

      items:
        Number(first.items || 0) +
        Number(second.items || 0)
    };
  }
  
  
  const today =
    calculateSummary(
      todayStart,
      tomorrowStart
    );


  const event =
    eventStart && eventEnd
      ? calculateSummary(
          eventStart,
          eventEnd
        )
      : {
          amount: 0,
          transactions: 0,
          items: 0
        };


  /*
   * MONTH / YTD
   *
   * IndexedDB is known complete beginning
   * at oldestLocalDate.
   *
   * Anything earlier than that boundary
   * is summarized directly by Google.
   */

  let month = {
    amount: 0,
    transactions: 0,
    items: 0
  };


  let ytd = {
    amount: 0,
    transactions: 0,
    items: 0
  };


  /*
   * Individual-item totals returned by
   * the same Google Summary requests
   * already needed for the main table.
   */

  let googleMonthItemTotals = {};
  let googleYtdItemTotals = {};


  const monthStartDate =
    formatLocalDate(
      monthStart
    );


  const yearStartDate =
    formatLocalDate(
      yearStart
    );


  /*
   * Determine where the local portion
   * of Month and YTD begins.
   */

  const monthLocalStart =
    oldestLocalDate &&
    oldestLocalDate > monthStartDate
      ? new Date(
          Number(
            oldestLocalDate.slice(0, 4)
          ),
          Number(
            oldestLocalDate.slice(5, 7)
          ) - 1,
          Number(
            oldestLocalDate.slice(8, 10)
          )
        )
      : monthStart;


  const ytdLocalStart =
    oldestLocalDate &&
    oldestLocalDate > yearStartDate
      ? new Date(
          Number(
            oldestLocalDate.slice(0, 4)
          ),
          Number(
            oldestLocalDate.slice(5, 7)
          ) - 1,
          Number(
            oldestLocalDate.slice(8, 10)
          )
        )
      : yearStart;


  /*
   * First calculate the portion that is
   * already complete in IndexedDB.
   */

  month =
    calculateSummary(
      monthLocalStart,
      tomorrowStart
    );


  ytd =
    calculateSummary(
      ytdLocalStart,
      tomorrowStart
    );


  /*
   * If our known-complete local history
   * begins after January 1, Google owns
   * the older part of YTD.
   *
   * One Google request is enough.
   */

  if (
    oldestLocalDate &&
    oldestLocalDate > yearStartDate
  ) {

    const googleDateTo =
      getPreviousLocalDate(
        oldestLocalDate
      );


    try {

      const googleYtdResult =
        await googleRequest(
          "getSummary",
          {
            dateFrom:
              yearStartDate,

            dateTo:
              googleDateTo
          }
        );


      const googleYtd =
        googleYtdResult.summary || {
          amount: 0,
          transactions: 0,
          items: 0,
          itemTotals: {}
        };


      googleYtdItemTotals =
        googleYtd.itemTotals || {};


      ytd =
        combineSummary(
          googleYtd,
          ytd
        );

      /*
       * Month needs only the part of that
       * Google range that falls inside
       * the current month.
       */

      if (
        oldestLocalDate >
        monthStartDate
      ) {

        const googleMonthResult =
          await googleRequest(
            "getSummary",
            {
              dateFrom:
                monthStartDate,

              dateTo:
                googleDateTo
            }
          );


        const googleMonth =
          googleMonthResult.summary || {
            amount: 0,
            transactions: 0,
            items: 0,
            itemTotals: {}
          };


        googleMonthItemTotals =
          googleMonth.itemTotals || {};


        month =
          combineSummary(
            googleMonth,
            month
          );
        }


    } catch (error) {

      console.error(
        "Unable to load historical summary:",
        error
      );


      toast(
        "Unable to load complete summary."
      );
    }
  }

  /*
   * Amount
   */

  $("#summaryTodayAmount")
    .textContent =
      money(
        today.amount
      );


  $("#summaryEventAmount")
    .textContent =
      money(
        event.amount
      );


  $("#summaryMonthAmount")
    .textContent =
      money(
        month.amount
      );


  $("#summaryYtdAmount")
    .textContent =
      money(
        ytd.amount
      );


  /*
   * Transactions
   */

  $("#summaryTodayTransactions")
    .textContent =
      today.transactions;


  $("#summaryEventTransactions")
    .textContent =
      event.transactions;


  $("#summaryMonthTransactions")
    .textContent =
      month.transactions;


  $("#summaryYtdTransactions")
    .textContent =
      ytd.transactions;


  /*
   * Items sold
   */

  $("#summaryTodayItems")
    .textContent =
      today.items;


  $("#summaryEventItems")
    .textContent =
      event.items;
////////////////////////////////////////

  $("#summaryMonthItems")
    .textContent =
      month.items;


  $("#summaryYtdItems")
    .textContent =
      ytd.items;


  /*
   * Detailed item sales.
   *
   * Event comes entirely from IndexedDB.
   *
   * Month and YTD combine the locally
   * complete portion with the historical
   * item totals returned by Google.
   */

  const todayItemTotals =
    new Map();

  const eventItemTotals =
    new Map();

  const monthItemTotals =
    new Map();

  const ytdItemTotals =
    new Map();


  summaryItems.forEach(
    (item) => {

      const date =
        getTransactionDate(
          item.transactionId
        );


      if (!date) {
        return;
      }


      const itemName =
        String(
          item.itemName || ""
        ).trim();


      if (!itemName) {
        return;
      }


      const quantity =
        Number(
          item.quantity || 0
        );

      /*
       * Today
       */

      if (
        date >= todayStart &&
        date < tomorrowStart
      ) {

        todayItemTotals.set(
          itemName,
          (
            todayItemTotals.get(
              itemName
            ) || 0
          ) + quantity
        );
      }


      /*
       * Event
       */

      if (
        eventStart &&
        eventEnd &&
        date >= eventStart &&
        date < eventEnd
      ) {

        eventItemTotals.set(
          itemName,
          (
            eventItemTotals.get(
              itemName
            ) || 0
          ) + quantity
        );
      }


      /*
       * Local Month portion.
       */

      if (
        date >= monthLocalStart &&
        date < tomorrowStart
      ) {

        monthItemTotals.set(
          itemName,
          (
            monthItemTotals.get(
              itemName
            ) || 0
          ) + quantity
        );
      }


      /*
       * Local YTD portion.
       */

      if (
        date >= ytdLocalStart &&
        date < tomorrowStart
      ) {

        ytdItemTotals.set(
          itemName,
          (
            ytdItemTotals.get(
              itemName
            ) || 0
          ) + quantity
        );
      }
    }
  );


  /*
   * Add the older historical portions
   * returned by Google.
   */

  Object.entries(
    googleMonthItemTotals
  ).forEach(
    ([itemName, quantity]) => {

      monthItemTotals.set(
        itemName,
        (
          monthItemTotals.get(
            itemName
          ) || 0
        ) +
        Number(quantity || 0)
      );
    }
  );


  Object.entries(
    googleYtdItemTotals
  ).forEach(
    ([itemName, quantity]) => {

      ytdItemTotals.set(
        itemName,
        (
          ytdItemTotals.get(
            itemName
          ) || 0
        ) +
        Number(quantity || 0)
      );
    }
  );


  /*
   * Keep every item that appears in
   * Event, Month, or YTD.
   */

  const itemNames =
    new Set([
      ...todayItemTotals.keys(),
      ...eventItemTotals.keys(),
      ...monthItemTotals.keys(),
      ...ytdItemTotals.keys()
    ]);


  summaryItemRankingData =
    [...itemNames]
      .map(
      
        (itemName) => ({
          itemName,
          
          today:
            todayItemTotals.get(
              itemName
            ) || 0,

          event:
            eventItemTotals.get(
              itemName
            ) || 0,

          month:
            monthItemTotals.get(
              itemName
            ) || 0,

          ytd:
            ytdItemTotals.get(
              itemName
            ) || 0
        })
      );

  renderSummaryItemRanking();

}

function renderSummaryItemRanking() {

  const itemRanking =
    summaryItemRankingData
      .slice()
      .sort(
        (first, second) => {

          const quantityDifference =
            second[summaryItemSort] -
            first[summaryItemSort];


          if (quantityDifference) {
            return quantityDifference;
          }


          return first.itemName
            .localeCompare(
              second.itemName
            );
        }
      );


  if (!itemRanking.length) {

    $("#summaryItemList")
      .innerHTML = `
        <tr>
          <th>No item sales</th>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      `;

    return;
  }


  $("#summaryItemList")
    .innerHTML =
      itemRanking
        .map(
          (item) => `
            <tr>

              <th>
                ${escapeHtml(
                  item.itemName
                )}
              </th>

              <td>
                ${item.today}
              </td>

              <td>
                ${item.event}
              </td>

              <td>
                ${item.month}
              </td>

              <td>
                ${item.ytd}
              </td>

            </tr>
          `
        )
        .join("");
}

function updateSummarySortHeadings() {

  $$("[data-summary-sort]")
    .forEach(
      (heading) => {

        heading.classList.toggle(
          "active",
          heading.dataset.summarySort ===
            summaryItemSort
        );
      }
    );
}


/* =========================================================
   UTILITIES
   ========================================================= */

function updateConnectionStatus() {

  $("#status").textContent =
    navigator.onLine
      ? "Online"
      : "Offline";
}

window.addEventListener(
  "online",
  updateConnectionStatus
);


window.addEventListener(
  "offline",
  updateConnectionStatus
);

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,   // for no cents/decimal digits
    maximumFractionDigits: 0    // for no cents/decimal digits

  }).format(Number(value) || 0);
}


function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}


function toast(message) {
  const toastElement =
    $("#toast");

  toastElement.textContent =
    message;

  toastElement.classList.add(
    "show"
  );

  setTimeout(() => {
    toastElement.classList.remove(
      "show"
    );
  }, 2000);
}


function isMobileDevice() {

  /*
   * Detect phones and tablets.
   *
   * The iPad check also catches newer
   * iPads that identify themselves as
   * Macintosh.
   */

  return (
    /Android|iPhone|iPad|iPod/i.test(
      navigator.userAgent
    ) ||
    (
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1
    )
  );
}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

function updateAvailableButton() {

  const button =
    $("#updateAvailable");

  if (!button) {
    return;
  }


  button.hidden =
    !appUpdateAvailable;


  if (!appUpdateAvailable) {
    return;
  }


  /*
   * Do not allow an application reload
   * while a sale is in progress.
   */

  button.disabled =
    getCartLines().length > 0;
}


function markAppUpdateAvailable() {

  appUpdateAvailable = true;

  updateAvailableButton();

  console.log(
    "Application update available."
  );
}


function startServiceWorker() {
  if ("serviceWorker" in navigator) {

    /*
     * Receive the version number from the
     * service worker controlling this page.
     *
     * This represents the version of the
     * application currently running.
     */

    navigator.serviceWorker.addEventListener(
      "message",
      (event) => {

        if (
          event.data?.type ===
          "APP_VERSION"
        ) {

          const version =
            event.data.version;

          /*
           * The first version reported belongs
           * to the application that loaded this
           * page.
           */

          if (!loadedAppVersion) {

            loadedAppVersion =
              version;

            $("#appVersion").textContent =
              version;

            return;
          }


          /*
           * A different worker version has taken
           * control while this page is still open.
           *
           * Keep displaying the version of the
           * application code currently running,
           * and quietly offer a reload.
           */

          if (
            version !==
            loadedAppVersion
          ) {

            markAppUpdateAvailable();
          }
        }
      }   
    );

    /*
     * A newly installed worker uses
     * skipWaiting() + clients.claim(), so it can
     * become controller without reloading this page.
     *
     * When that happens, ask the new controller
     * for its version.
     */

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {

        const worker =
          navigator.serviceWorker.controller;

        if (worker) {

          worker.postMessage({
            type: "GET_VERSION"
          });
        }
      }
    );    

    /*
     * Register the service worker.
     */

    navigator.serviceWorker
      .register(
        "service-worker.js"
      )
      .then((registration) => {

        /*
         * Ask only the service worker currently
         * controlling this page for its version.
         *
         * Do not ask an installing or waiting
         * service worker because that may represent
         * a newer version that is not yet running
         * on this screen.
         */

        const worker =
          navigator.serviceWorker.controller ||
          registration.active;

        if (worker) {
          worker.postMessage({
            type: "GET_VERSION"
          });
        }


        /*
         * Check for a newer version in the
         * background.
         *
         * A newer version may install and activate,
         * but this page is intentionally NOT
         * reloaded. The newly cached application
         * will run the next time the POS is closed
         * and opened.
         */

        if (navigator.onLine) {
          registration.update();
        }

      })
      .catch((error) => {

        console.error(
          "Service worker registration failed:",
          error
        );

      });
  }
}


/* =========================================================
   BACKGROUND HOUSEKEEPING
   ========================================================= */

function runBackgroundHousekeeping() {
console.log(
  "Background housekeeping started."
);
  /*
   * Retry any transactions that have not
   * yet been archived.
   *
   * Pruning runs only after that archive
   * attempt has finished.
   */

  archiveTransactions()
    .then(
      () => {
        return pruneOldLocalTransactions();
      }
    )
    .catch(
      (error) => {

        console.error(
          "Background transaction housekeeping failed:",
          error
        );
      }
    );


  /*
   * Back up Items if anything has changed.
   *
   * This runs independently from transaction
   * archiving/pruning.
   */

  backupItems();


  /*
   * Check whether service-worker.js has
   * changed while the POS has been running.
   */

  if (
    navigator.onLine &&
    "serviceWorker" in navigator
  ) {

    navigator.serviceWorker
      .getRegistration()
      .then(
        async (registration) => {

          if (!registration) {

            console.log(
              "No service worker registration found."
            );

            return;
          }


          console.log(
            "Checking for app update..."
          );


          await registration.update();


          console.log(
            "Service worker update check completed."
          );
        }
      )
      .catch(
        (error) => {

          console.error(
            "Unable to check for app update:",
            error
          );
        }
      );
  }
}


document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "hidden"
    ) {

      runBackgroundHousekeeping();
    }
  }
);


/* =========================================================
   START APPLICATION
   ========================================================= */

async function initializeApp() {  
  try {

    $("#status").textContent =
      "Starting...";


    await openDatabase();
    await initializeMetadata();
    
    await bootstrapTransactionHistory();  // this is for a cold-start device
    
    await initializeItems();
    
    initializeNavigation();
    initializeItemEvents();
    initializePosEvents();
    initializeTransactionEvents();

    await loadItems();

    renderCart();
    
    updateConnectionStatus();

    console.log(
      "MidlyEgg POS ready."
    );

    /*
     * Retry any transactions that did
     * not finish archiving during an
     * earlier session.
     *
     * Do not wait for Google.
     */

    archiveTransactions();
    
  } catch (error) {

    console.error(
      "Unable to initialize POS:",
      error
    );


    $("#status").textContent =
      "Database error";
  }
}


startServiceWorker();
initializeApp();