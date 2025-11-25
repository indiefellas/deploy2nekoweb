import fs from "fs/promises";
import path from "path";
import { zip } from "zip-a-folder";
import NekoAPI from '@indiefellas/nekoweb-api';
import { version } from './package.json'
import { LogType } from "@indiefellas/nekoweb-api/types";

let {
  D2N_NW_API_KEY,
  D2N_NW_DOMAIN,
  D2N_NW_USERNAME,
  D2N_DIRECTORY,
} = process.env;
if (D2N_NW_USERNAME == null) D2N_NW_USERNAME = ''

Object.entries({ D2N_NW_API_KEY, D2N_NW_DOMAIN, D2N_DIRECTORY }).forEach(x => {
  if (x[1] == null) throw new Error(`Environment variable for ${x[0]} cannot be null.`)
})

const logging = (type: LogType, msg: string) => {
  switch (type) {
    case LogType.Info: 
      console.log(msg);
      break;
    case LogType.Warn:
      console.warn(msg);
      break;
    case LogType.Error:
      console.error(msg);
      break;
  }
}

const neko = new NekoAPI({
  apiKey: D2N_NW_API_KEY!,
  appName: `deploy2nekoweb/${version} (https://github.com/indiefellas/deploy2nekoweb)`,
  logging,
  request: {}
}) 

let limits = await neko.getFileLimits()
let bigUploadLimits = limits.big_uploads
let generalLimits = limits.general
let zipLimits = limits.zip

const refreshLimits = async () => {
  limits = await neko.getFileLimits()
  bigUploadLimits = limits.big_uploads
  generalLimits = limits.general
  zipLimits = limits.zip
}

const sleepUntil = (time: number) => {
  const now = Date.now();
  if (now >= time) return;
  return new Promise((resolve) => setTimeout(resolve, time - now));
};

const zipDirectory = async (name: string) => {
  const zipPath = path.join(path.dirname(__dirname), `${name}.zip`);
  await zip(path.join(path.dirname(__dirname), D2N_DIRECTORY!), zipPath, {
    destPath: D2N_NW_DOMAIN,
  });
  return zipPath;
};

const cleanUp = async (zipPath: string) => {
  await fs.rm(zipPath);
  console.log("Upload completed and cleaned up.");
};

const uploadToNekoweb = async () => {
  console.log("Uploading files to Nekoweb...");

  await refreshLimits()
  if (bigUploadLimits.remaining < 1) await sleepUntil(bigUploadLimits.reset);
  if (generalLimits.remaining < 1) await sleepUntil(generalLimits.reset);

  await neko.delete(D2N_NW_DOMAIN!)
    .catch(_ => null)

  const zipPath = await zipDirectory('build');
  const fileBuffer = await fs.readFile(zipPath);

  const file = await neko.createBigFile()
  await file.append(fileBuffer);
  await file.import()

  await cleanUp(zipPath);
};

uploadToNekoweb().catch((err) => {
  console.error(
    `An error occurred during the upload process: ${err.message}\n\nError info: ${err.stack}`
  );
});
