import fs from "fs/promises";
import FormData from "form-data";
import path from "path";
import { zip } from "zip-a-folder";
import NekoAPI from '@indiefellas/nekoweb-api';
import { version } from './package.json'
import { LogType } from "@indiefellas/nekoweb-api/types";

let {
  D2N_NW_API_KEY,
  D2N_NW_DOMAIN,
  D2N_NW_USERNAME,
  D2N_NW_COOKIE,
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

const createNormalAPI = () =>
  new NekoAPI({
    apiKey: D2N_NW_API_KEY!,
    appName: `deploy2nekoweb/${version} (https://github.com/indiefellas/deploy2nekoweb)`,
    logging,
    request: {}
  })

let neko;
if (D2N_NW_COOKIE != null) {
  neko = new NekoAPI({
    apiKey: '',
    appName: `deploy2nekoweb/${version} (https://github.com/indiefellas/deploy2nekoweb)`,
    logging,
    request: {
      headers: {
        Authorization: '',
        Origin: 'https://nekoweb.org',
        Host: 'nekoweb.org',
        'User-Agent': ``,
        Referer: `https://nekoweb.org/?${encodeURIComponent(
          'deploy2nekoweb build script (please dont ban us)'
        )}`,
        Cookie: `token=${D2N_NW_COOKIE}`,
      }
    }
  });
} else {
  neko = createNormalAPI()
}

await neko.getFileLimits()
  .catch(x => {
    console.warn('---')
    console.warn()
    console.warn('There was an issue trying to authenticate your Nekoweb cookie, try generating another cookie.')
    console.warn('Skipping cookie-related endpoints...')
    console.warn()
    console.warn('---')
    D2N_NW_COOKIE = undefined
    neko = createNormalAPI()
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

const getCSRFToken = async () => await neko.generic("/csrf", { method: "GET" });

const finalizeUpload = async () => {
  if (D2N_NW_COOKIE == null) return;

  try {
    const data = new FormData()
    data.append('pathname', `/${D2N_NW_DOMAIN}/deploy2nekoweb.html`)
    data.append('content', `<!--
This is an auto-generated file created by deploy2nekoweb.
        
This file is used to put you on the 'Last Updated' page
on Nekoweb.

You can delete this file if you want, but it will come
back the next time you deploy using deploy2nekoweb.

               https://deploy.nekoweb.org
-->
<!-- ${Date.now()} -->`)
    data.append('site', D2N_NW_USERNAME)
    data.append('csrf', await getCSRFToken())

    await neko.generic('/files/edit', {
      method: 'POST',
      data
    })
    console.log("Sent cookie request.");
  } catch (e) {
    console.error('Failed to send cookie request.')
  }
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

  try {
    await neko.delete(D2N_NW_DOMAIN!)
  } catch(e) {}

  const zipPath = await zipDirectory('build');
  const fileBuffer = await fs.readFile(zipPath);

  const file = await neko.createBigFile()
  await file.append(fileBuffer);
  await file.import()

  await finalizeUpload();
  await cleanUp(zipPath);
};

uploadToNekoweb().catch((err) => {
  console.error(
    `An error occurred during the upload process: ${err.message}\n\nError info: ${err.stack}`
  );
});
