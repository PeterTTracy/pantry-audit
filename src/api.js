// Same call surface the pages always used, now backed by the on-device
// IndexedDB data layer instead of a REST server.
import {
  listUnits, listLocations, listProducts, getProduct, saveAudit,
  importFile, compliance, exportXlsx, downloadBackup, restoreBackup,
} from './lib/data';

export const api = {
  units: () => listUnits(),
  locations: (unit) => listLocations(unit),
  products: (filters) => listProducts(filters),
  product: (id) => getProduct(id),
  saveAudit: (id, fields, photoFile) => saveAudit(id, fields, photoFile),
  importFile: (file) => importFile(file),
  compliance: () => compliance(),
  exportXlsx: () => exportXlsx(),
  downloadBackup: () => downloadBackup(),
  restoreBackup: (file) => restoreBackup(file),
};
