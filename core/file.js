const path = require('path'),
  fs = require('fs-extra'),
  validator = require('validator'),
  sharp = require('sharp');

const settings = require('../settings.json'),
  dev = require('./dev-log'),
  api = require('./api'),
  thumbs = require('./thumbs');

module.exports = (function() {
  const API = {
    getFolder: ({ type, slugFolderName }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — getFolder type = ${type} with slugFolderName = ${slugFolderName}`
        );

        if (!settings.structure.hasOwnProperty(type)) {
          reject(`Missing type ${type} in settings.json`);
        }

        const baseFolderPath = settings.structure[type].path;
        const mainFolderPath = api.getFolderPath(baseFolderPath);

        _getFolderSlugs(mainFolderPath).then(folders => {
          if (folders.length === 0) {
            resolve();
          }

          var allFoldersData = [];

          if (
            slugFolderName !== undefined &&
            folders.includes(slugFolderName)
          ) {
            folders = [slugFolderName];
          }

          folders.forEach(slugFolderName => {
            const thisFolderPath = path.join(mainFolderPath, slugFolderName);
            // For each folder, read their meta file
            allFoldersData.push(
              new Promise((resolve, reject) => {
                dev.logverbose(`Finding meta for folder = ${thisFolderPath}`);
                const metaFolderPath = path.join(
                  thisFolderPath,
                  settings.folderMetaFilename + settings.metaFileext
                );

                readMetaFile(metaFolderPath)
                  .then(meta => {
                    meta = _sanitizeMetaFromFile({ type, meta });
                    meta.slugFolderName = slugFolderName;

                    if (settings.structure[type].hasOwnProperty('medias')) {
                      meta.medias = {};
                    }

                    meta.fullFolderPath = thisFolderPath;

                    resolve({ [slugFolderName]: meta });
                  })
                  .catch(err => {
                    dev.error(
                      `Couldn’t read folder meta, most probably because it doesn’t exist: ${err}`
                    );
                    resolve({});
                  });
              })
            );

            // For each folder, find a preview (if it exists)
            allFoldersData.push(
              new Promise((resolve, reject) => {
                dev.logverbose(
                  `Finding preview for folder = ${thisFolderPath}`
                );
                const pathToPreview = path.join(
                  thisFolderPath,
                  settings.folderPreviewFilename + settings.thumbExt
                );
                fs.access(pathToPreview, fs.F_OK, err => {
                  preview_name = !err
                    ? settings.folderPreviewFilename + settings.thumbExt
                    : '';
                  resolve({
                    [slugFolderName]: {
                      preview: preview_name
                    }
                  });
                });
              })
            );
          });
          Promise.all(allFoldersData).then(parsedFoldersData => {
            dev.logverbose(
              `All folders meta have been processed`,
              JSON.stringify(parsedFoldersData, null, 4)
            );

            // on se balade dans l’array, on attrappe la key
            // et on merge tout ça dans un nouvel objet du type :
            /*
              { 
                mon-dossier: {
                  name: "Mon Dossier",
                  date_crated: "",
                  preview: "meta_preview.jpeg"
                },
                mon-deuxième-dossier: { 

                }
              }
            */

            // Reunite array items as a single big object
            let flatObjFoldersData = {};
            parsedFoldersData.forEach(fmeta => {
              if (Object.keys(fmeta).length > 0) {
                let slugFolderName = Object.keys(fmeta)[0];
                if (!flatObjFoldersData.hasOwnProperty(slugFolderName)) {
                  flatObjFoldersData[slugFolderName] = {};
                }
                Object.assign(
                  flatObjFoldersData[slugFolderName],
                  fmeta[slugFolderName]
                );
              }
            });
            resolve(flatObjFoldersData);
          });
        });
      });
    },
    createFolder: ({ type, data }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — createFolder : will create a new folder for type = ${type} with: ${JSON.stringify(
            data,
            null,
            4
          )}`
        );

        if (!data.hasOwnProperty('name')) {
          data.name = 'Untitled Folder';
        }

        if (!settings.structure.hasOwnProperty(type)) {
          reject(`Missing type ${type} in settings.json`);
        }

        const baseFolderPath = settings.structure[type].path;
        const mainFolderPath = api.getFolderPath(baseFolderPath);

        _getFolderSlugs(mainFolderPath).then(folders => {
          let slugFolderName = api.slug(data.name);
          if (slugFolderName === '') {
            slugFolderName = 'untitled';
          }

          if (folders.length > 0) {
            let index = 0;
            let newSlugFolderName = slugFolderName;
            while (folders.indexOf(newSlugFolderName) !== -1) {
              index++;
              newSlugFolderName = `${newSlugFolderName}-${index}`;
            }
            slugFolderName = newSlugFolderName;
            dev.logverbose(`Proposed slug: ${slugFolderName}`);
          }

          const thisFolderPath = path.join(mainFolderPath, slugFolderName);
          dev.logverbose(`Making a new folder at path ${thisFolderPath}`);

          fs.mkdirp(
            thisFolderPath,
            () => {
              let tasks = [];

              if (data.hasOwnProperty('preview_rawdata')) {
                tasks.push(
                  _storeFoldersPreview(thisFolderPath, data.preview_rawdata)
                );
              }

              tasks.push(
                new Promise(function(resolve, reject) {
                  data = _makeDefaultMetaFromStructure({
                    type,
                    method: 'create',
                    existing: data
                  });

                  const metaFolderPath = path.join(
                    thisFolderPath,
                    settings.folderMetaFilename + settings.metaFileext
                  );

                  api
                    .storeData(metaFolderPath, data, 'create')
                    .then(function(meta) {
                      dev.logverbose(
                        `New folder meta file created at path: ${metaFolderPath} with meta: ${JSON.stringify(
                          meta,
                          null,
                          4
                        )}`
                      );
                      resolve();
                    })
                    .catch(err => {
                      reject(err);
                    });
                })
              );

              Promise.all(tasks).then(() => {
                resolve(slugFolderName);
              });
            },
            function(err, p) {
              dev.error(`Failed to create folder ${slugFolderName}: ${err}`);
              reject(err);
            }
          );
        });
      });
    },
    editFolder: ({ type, foldersData, newFoldersData }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — editFolder : will edit folder with type = ${type} 
          with ${JSON.stringify(newFoldersData, null, 4)} 
          with existing data ${JSON.stringify(foldersData, null, 4)}`
        );

        if (!settings.structure.hasOwnProperty(type)) {
          reject(`Missing type ${type} in settings.json`);
        }
        const baseFolderPath = settings.structure[type].path;
        const mainFolderPath = api.getFolderPath(baseFolderPath);

        // remove slugFolderKey
        let slugFolderName = foldersData.slugFolderName;
        const thisFolderPath = path.join(mainFolderPath, slugFolderName);
        let tasks = [];

        if (newFoldersData.hasOwnProperty('preview_rawdata')) {
          dev.logverbose('Updating folders preview');
          let preview_rawdata = newFoldersData.preview_rawdata;
          // store preview with sharp
          tasks.push(_storeFoldersPreview(thisFolderPath, preview_rawdata));
        }

        let updateFoldersMeta = new Promise((resolve, reject) => {
          dev.logverbose('Updating folders meta');
          // cleaning up stored meta
          foldersData = _makeDefaultMetaFromStructure({
            type,
            method: 'create',
            existing: foldersData
          });

          newFoldersData = _makeDefaultMetaFromStructure({
            type,
            method: 'update',
            existing: newFoldersData
          });

          // overwrite stored obj with new informations
          Object.assign(foldersData, newFoldersData);

          const metaFolderPath = path.join(
            thisFolderPath,
            settings.folderMetaFilename + settings.metaFileext
          );

          api.storeData(metaFolderPath, foldersData, 'update').then(
            function(meta) {
              dev.logverbose(
                `Update folder meta file at path: ${metaFolderPath} with meta: ${JSON.stringify(
                  meta,
                  null,
                  4
                )}`
              );
              resolve();
            },
            function(err) {
              reject(`Couldn't update folder meta: ${err}`);
            }
          );
        });
        tasks.push(updateFoldersMeta);

        Promise.all(tasks)
          .then(() => {
            dev.logverbose(`COMMON — editFolder : now resolving`);
            resolve(slugFolderName);
          })
          .catch(err => {
            dev.error(
              `Failed to edit folder slugFolderName = ${slugFolderName}: ${err}`
            );
            reject(err);
          });
      });
    },
    removeFolder: ({ type, slugFolderName }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — removeFolder : will remove folder: ${slugFolderName}`
        );

        if (!settings.structure.hasOwnProperty(type)) {
          reject(`Missing type ${type} in settings.json`);
        }
        const baseFolderPath = settings.structure[type].path;
        const mainFolderPath = api.getFolderPath(baseFolderPath);

        // remove slugFolderKey
        const thisFolderPath = path.join(mainFolderPath, slugFolderName);
        const movedFolderPath = path.join(
          mainFolderPath,
          settings.deletedFolderName,
          slugFolderName
        );

        fs
          .move(thisFolderPath, movedFolderPath, { overwrite: true })
          .then(() => {
            dev.logfunction(
              `COMMON — removeFolder : folder ${slugFolderName} has been moved to ${movedFolderPath}`
            );
            resolve();
          })
          .catch(err => {
            reject(err);
          });
      });
    },

    getMediaMetaNames: ({ type, slugFolderName, metaFileName }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — getMediaMetaNames in type = ${type}, with slugFolderName = ${slugFolderName} and metaFileName = ${metaFileName}`
        );
        if (slugFolderName === undefined) {
          dev.error(`Missing slugFolderName to read medias from.`);
          reject();
        }
        if (metaFileName === undefined) {
          dev.logverbose(
            `Missing metaFileName to read medias from ${slugFolderName}. Reading all medias instead.`
          );
        }
        dev.logverbose(
          `COMMON — getMediaMetaNames — slugFolderName: ${slugFolderName} — metaFileName: ${metaFileName}`
        );

        let slugFolderPath = api.getFolderPath(
          path.join(settings.structure[type].path, slugFolderName)
        );

        fs.readdir(slugFolderPath, function(err, filenames) {
          if (err) {
            dev.error(`Couldn't read content dir: ${err}`);
            return reject(err);
          }
          if (filenames === undefined) {
            dev.error(`No medias for folder found: ${err}`);
            return resolve();
          }

          dev.logverbose(
            `Found this many (${filenames.length}) filenames: ${filenames}`
          );

          let list_metaFileName = filenames.filter(_metaFileName => {
            return (
              !new RegExp(settings.regexpMatchFolderNames, 'i').test(
                _metaFileName
              ) &&
              // endswith settings.metaFileext
              _metaFileName.endsWith(settings.metaFileext) &&
              // not meta.txt
              _metaFileName !==
                settings.folderMetaFilename + settings.metaFileext &&
              // not a folder preview
              _metaFileName !==
                settings.folderPreviewFilename + settings.thumbExt &&
              // not a dotfile
              _metaFileName.indexOf('.') !== 0 &&
              // if has metaFileName, only if it matches
              (metaFileName ? _metaFileName === metaFileName : true)
            );
          });
          dev.logverbose(
            `Number of medias that match in ${slugFolderPath} = ${
              list_metaFileName.length
            }. Media(s) is(are) ${list_metaFileName.join()}`
          );

          if (list_metaFileName.length === 0) {
            dev.logverbose(
              `Since no medias is in this folder, let’s abort right there.`
            );
            return resolve([]);
          } else {
            return resolve(list_metaFileName);
          }
        });
      });
    },
    readMediaList: ({ type, medias_list }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — readMediaList: medias_list = ${JSON.stringify(
            medias_list,
            null,
            4
          )}}`
        );

        if (medias_list.length === 0) {
          return resolve({});
        }

        var allMediasData = [];
        medias_list.forEach(({ slugFolderName, metaFileName }) => {
          if (slugFolderName === undefined || metaFileName === undefined) {
            return;
          }

          let fmeta = new Promise((resolve, reject) => {
            readMediaAndThumbs({
              type,
              slugFolderName,
              metaFileName
            }).then(meta => {
              if (meta === undefined) {
                resolve({});
              }
              meta.metaFileName = metaFileName;
              resolve({
                slugFolderName,
                mediaMeta: meta
              });
            });
          });
          allMediasData.push(fmeta);
        });

        Promise.all(allMediasData)
          .then(mediasMeta => {
            dev.logverbose(
              `readMediaList: gathered all metas, now processing : ${JSON.stringify(
                mediasMeta,
                null,
                4
              )}`
            );

            // reunite array items as a single big object
            let folders_and_medias = {};

            mediasMeta.map(d => {
              // dev.logverbose(
              //   `readMediaList: analyzing ${JSON.stringify(d, null, 4)}`
              // );

              if (Object.keys(d).length === 0 && d.constructor === Object) {
                return;
              }

              const slugFolderName = d.slugFolderName;
              const mediaMeta = d.mediaMeta;
              const metaFileName = mediaMeta.metaFileName;

              if (!folders_and_medias.hasOwnProperty(slugFolderName)) {
                folders_and_medias[slugFolderName] = {
                  medias: {}
                };
              }

              folders_and_medias[slugFolderName].medias[
                metaFileName
              ] = mediaMeta;
              return;
            });

            dev.logverbose(
              `All medias meta have been processed`,
              JSON.stringify(folders_and_medias, null, 4)
            );
            resolve(folders_and_medias);
          })
          .catch(err => {
            dev.error(`Failed readMediaList with ${err}`);
            reject();
          });
      });
    },
    createMediaMeta: ({ type, slugFolderName, additionalMeta }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — createMediaMeta : will create a new meta file 
          in folder ${slugFolderName}
          `
        );
        if (Object.keys(additionalMeta).length > 0) {
          dev.logverbose(
            `Has additional meta: ${JSON.stringify(additionalMeta, null, 4)}`
          );
        }

        let mediaName;
        let mediaPath;
        let metaFileName;
        if (additionalMeta.hasOwnProperty('media_filename')) {
          mediaName = additionalMeta.media_filename;
          mediaPath = path.join(api.getFolderPath(slugFolderName), mediaName);
          metaFileName = mediaName + settings.metaFileext;
        } else {
          let timeCreated = api.getCurrentDate();
          let randomString = (
            Math.random().toString(36) + '00000000000000000'
          ).slice(2, 3 + 2);
          metaFileName = `${timeCreated}-${randomString}${
            settings.metaFileext
          }`;
        }

        let slugFolderPath = api.getFolderPath(
          path.join(settings.structure[type].path, slugFolderName)
        );

        const metaFilePath = path.join(slugFolderPath, metaFileName);

        // check that a meta with this name doesn't exist already
        fs.access(metaFilePath, fs.F_OK, function(err) {
          // if there's nothing at path, we’re all good
          if (err) {
            // guess file type from filename
            if (
              !additionalMeta.hasOwnProperty('type') &&
              additionalMeta.hasOwnProperty('media_filename') &&
              mediaName !== undefined
            ) {
              let mediaFileExtension = new RegExp(
                settings.regexpGetFileExtension,
                'i'
              ).exec(mediaName)[0];
              dev.logverbose(
                `Trying to guess filetype from extension: ${mediaFileExtension}`
              );
              switch (mediaFileExtension.toLowerCase()) {
                case '.jpeg':
                case '.jpg':
                case '.png':
                case '.gif':
                case '.tiff':
                case '.tif':
                case '.dng':
                case '.svg':
                  additionalMeta.type = 'image';
                  break;
                case '.mp4':
                case '.mov':
                case '.webm':
                  additionalMeta.type = 'video';
                  break;
                case '.mp3':
                case '.wav':
                case '.m4a':
                  additionalMeta.type = 'audio';
                  break;
                case '.md':
                case '.rtf':
                  additionalMeta.type = 'text';
                  break;
              }
              dev.logverbose(`Type determined to be: ${additionalMeta.type}`);
            }

            let mdata = _makeDefaultMetaFromStructure({
              type,
              type_two: 'medias',
              method: 'create',
              existing: additionalMeta
            });

            let tasks = [];

            /***************************************************************************
                CREATED DATE
            ***************************************************************************/
            if (
              additionalMeta !== undefined &&
              additionalMeta.hasOwnProperty('fileCreationDate')
            ) {
              dev.logverbose(`Setting created from additionalMeta`);
              mdata.date_created = api.convertDate(
                additionalMeta.fileCreationDate
              );
            } else {
              if (mediaName !== undefined) {
                dev.logverbose(`Setting created from file birthtime`);
                let getFileCreationDate = new Promise((resolve, reject) => {
                  fs.stat(mediaPath, function(err, stats) {
                    if (err) {
                      resolve();
                    }
                    mdata.date_created = api.convertDate(
                      new Date(stats.birthtime)
                    );
                    resolve();
                  });
                });
                tasks.push(getFileCreationDate);
              }
            }

            if (mdata.type === 'image') {
              dev.logverbose(`Looking for EXIF for image`);
              let getEXIFTimestamp = new Promise((resolve, reject) => {
                thumbs
                  .getTimestampFromEXIF(mediaPath)
                  .then(ts => {
                    if (ts === false) {
                      dev.logverbose(`No timestamp found in EXIF.`);
                    } else {
                      let localTS = api.parseUTCDate(ts);
                      dev.logverbose(
                        `getEXIFData timestamp to date : ${api.convertDate(
                          localTS
                        )}`
                      );
                      mdata.date_created = api.convertDate(localTS);
                    }
                    resolve();
                  })
                  .catch(err => {
                    dev.logverbose(`No EXIF data to read from: ${err}`);
                    resolve();
                  });
              });
              tasks.push(getEXIFTimestamp);
            }

            /***************************************************************************
                RATIO
            ***************************************************************************/
            if (mdata.type === 'image') {
              let getEXIFRatio = new Promise((resolve, reject) => {
                thumbs
                  .getRatioFromEXIF(mediaPath)
                  .then(mediaRatio => {
                    dev.log(`getEXIFData mediaRatio : ${mediaRatio}`);
                    if (mediaRatio !== undefined) {
                      mdata.ratio = mediaRatio;
                    }
                    resolve();
                  })
                  .catch(err => {
                    dev.error(`No EXIF data to read from: ${err}`);
                    resolve();
                  });
              });
              tasks.push(getEXIFRatio);
            } else if (mdata.type === 'video' || mdata.type === 'audio') {
              let getMediaRatio = new Promise((resolve, reject) => {
                thumbs
                  .getMediaRatio(mediaPath)
                  .then(mediaRatio => {
                    dev.log(`getMediaRatio : ${mediaRatio}`);
                    if (mediaRatio !== undefined) {
                      mdata.ratio = mediaRatio;
                    }
                    resolve();
                  })
                  .catch(err => {
                    dev.error(`No probe data to read from: ${err}`);
                    resolve();
                  });
              });
              tasks.push(getMediaRatio);
            }

            /***************************************************************************
                DURATION
            ***************************************************************************/
            if (mdata.type === 'video' || mdata.type === 'audio') {
              // get video or audio duration
              let getMediaDuration = new Promise((resolve, reject) => {
                dev.logverbose(`Will attempt to get media duration.`);
                thumbs
                  .getMediaDuration(mediaPath)
                  .then(duration => {
                    dev.log(`getMediaDuration: ${duration}`);
                    if (duration) {
                      mdata.duration = duration;
                    }
                    resolve();
                  })
                  .catch(err => {
                    dev.error(`No probe data to read from: ${err}`);
                    resolve();
                  });
              });
              tasks.push(getMediaDuration);
            }

            /***************************************************************************
                DURATION
            ***************************************************************************/
            if (mdata.type === 'image') {
              let getFullEXIF = new Promise((resolve, reject) => {
                thumbs.getEXIFData(mediaPath).then(exifdata => {
                  if (exifdata) {
                    // mdata.exif = validator.escape(JSON.stringify(exifdata));
                  }
                  resolve();
                });
              });
              tasks.push(getFullEXIF);
            }

            /***************************************************************************
                DO IT ALL
            ***************************************************************************/
            Promise.all(tasks).then(() => {
              api.storeData(metaFilePath, mdata, 'create').then(
                function(meta) {
                  dev.logverbose(
                    `New media meta file created at path: ${metaFilePath} with meta: ${JSON.stringify(
                      meta,
                      null,
                      4
                    )}`
                  );
                  resolve(metaFileName);
                },
                function(err) {
                  reject(`Couldn't create media meta : ${err}`);
                }
              );
            });
          } else {
            // otherwise, something’s weird
            dev.error(`Found existing meta! Aborting`);
            reject();
          }
        });
      });
    },
    editMediaMeta: ({ type, slugFolderName, metaFileName, data }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — editMediaMeta : will edit media for ${slugFolderName} at ${metaFileName} with ${JSON.stringify(
            data,
            null,
            4
          )}`
        );

        readMediaMeta({ type, slugFolderName, metaFileName })
          .then(meta => {
            dev.logverbose(
              `Got meta, now updating for ${metaFileName} with ${JSON.stringify(
                meta,
                null,
                4
              )}`
            );

            // cleaning up stored meta
            meta = _makeDefaultMetaFromStructure({
              type,
              type_two: 'medias',
              method: 'create',
              existing: meta
            });

            let newMediaData = _makeDefaultMetaFromStructure({
              type,
              type_two: 'medias',
              method: 'update',
              existing: data
            });

            dev.logverbose(
              `Following datas will replace existing data for this media meta: ${JSON.stringify(
                newMediaData,
                null,
                4
              )}`
            );

            // overwrite stored obj with new informations
            Object.assign(meta, newMediaData);
            let tasks = [];

            let updateMediaMeta = new Promise((resolve, reject) => {
              let slugFolderPath = api.getFolderPath(
                path.join(settings.structure[type].path, slugFolderName)
              );
              let mediaMetaPath = path.join(slugFolderPath, metaFileName);

              api.storeData(mediaMetaPath, meta, 'update').then(
                meta => {
                  dev.logverbose(
                    `Updated media meta file at path: ${mediaMetaPath} with meta: ${JSON.stringify(
                      meta,
                      null,
                      4
                    )}`
                  );
                  resolve();
                },
                function(err) {
                  reject(`Couldn't update folder meta : ${err}`);
                }
              );
            });
            tasks.push(updateMediaMeta);

            if (meta.type === 'text' && data.hasOwnProperty('content')) {
              dev.logverbose(`Is text and need to update content.`);
              dev.logverbose(`New content: ${data.content}`);

              let updateTextMedia = new Promise((resolve, reject) => {
                // Legacy : if no filename in meta file when it is expected in blueprint
                // then it means its in the name of the text file
                function getMediaFilename(meta, metaFileName) {
                  if (
                    settings.structure[type].medias.fields.hasOwnProperty(
                      'media_filename'
                    )
                  ) {
                    if (meta.hasOwnProperty('media_filename')) {
                      return meta.media_filename;
                    } else {
                      return new RegExp(
                        settings.regexpRemoveFileExtension,
                        'i'
                      ).exec(metaFileName)[1];
                    }
                  }
                }
                let mediaFileName = getMediaFilename(meta, metaFileName);

                let slugFolderPath = api.getFolderPath(
                  path.join(settings.structure[type].path, slugFolderName)
                );
                let mediaPath = path.join(slugFolderPath, mediaFileName);

                let content = validator.escape(data.content + '');
                api
                  .storeData(mediaPath, content, 'update')
                  .then(content => {
                    dev.logverbose(
                      `Updated media file at path: ${mediaPath} with content: ${content}`
                    );
                    resolve();
                  })
                  .catch(err => {
                    reject(err);
                  });
              });
              tasks.push(updateTextMedia);
            }

            Promise.all(tasks).then(() => {
              resolve(slugFolderName);
            });
          })
          .catch(err => {
            reject(err);
          });
      });
    },
    removeMedia: ({ type, slugFolderName, metaFileName }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — removeMedia : will remove media at path: ${slugFolderName}/${metaFileName}`
        );

        readMediaMeta({ type, slugFolderName, metaFileName }).then(meta => {
          // Legacy : if no filename in meta file when it is expected in blueprint
          // then it means its in the name of the text file
          function getMediaFilename(meta, metaFileName) {
            if (
              settings.structure[type].medias.fields.hasOwnProperty(
                'media_filename'
              )
            ) {
              if (meta.hasOwnProperty('media_filename')) {
                return meta.media_filename;
              } else {
                return new RegExp(settings.regexpRemoveFileExtension, 'i').exec(
                  metaFileName
                )[1];
              }
            } else {
              return '';
            }
          }
          let mediaFileName = getMediaFilename(meta, metaFileName);

          let slugFolderPath = api.getFolderPath(
            path.join(settings.structure[type].path, slugFolderName)
          );

          let mediaMetaPath = path.join(slugFolderPath, metaFileName);
          let movedMediaMetaPath = path.join(
            slugFolderPath,
            settings.deletedFolderName,
            metaFileName
          );

          fs
            .move(mediaMetaPath, movedMediaMetaPath, { overwrite: true })
            .then(() => {
              if (mediaFileName === '') {
                return resolve();
              }
              let mediaPath = path.join(slugFolderPath, mediaFileName);
              let movedMediaPath = path.join(
                slugFolderPath,
                settings.deletedFolderName,
                mediaFileName
              );
              return fs.move(mediaPath, movedMediaPath, {
                overwrite: true
              });
            })
            .then(() => {
              return thumbs.removeMediaThumbs(slugFolderName, metaFileName);
            })
            .then(() => {
              resolve();
            })
            .catch(err => {
              reject(err);
            });
        });
      });
    },
    createMedia: ({ type, rawData, slugFolderName, additionalMeta = '' }) => {
      return new Promise(function(resolve, reject) {
        dev.logfunction(
          `COMMON — createMedia with type = ${type}, 
          slugFolderName = ${slugFolderName} 
          and additionalMeta = ${JSON.stringify(additionalMeta, null, 4)}`
        );

        if (!additionalMeta.hasOwnProperty('type')) {
          dev.logverbose(
            'Missing type field, so this media doesn’t have an associated file'
          );
          return resolve(additionalMeta);
        }

        let timeCreated = api.getCurrentDate();
        let randomString = (
          Math.random().toString(36) + '00000000000000000'
        ).slice(2, 3 + 2);

        let mediaName = additionalMeta.hasOwnProperty('type')
          ? `${additionalMeta.type}-${timeCreated}-${randomString}`
          : `${timeCreated}-${randomString}`;

        // Depending on the type of media we will create, we will need to act differently:
        // - 'image' -> use sharp and create a .jpeg from the buffer
        // - 'video' -> store the content to a file with storeMediaToDisk
        // - 'stopmotion' -> assemble all images to a video
        // - 'audio' -> store content with storeMediaToDisk
        // - 'text' -> store content with storeData

        let tasks = [];
        let slugFolderPath = api.getFolderPath(
          path.join(settings.structure[type].path, slugFolderName)
        );

        if (additionalMeta.type === 'image') {
          tasks.push(
            new Promise((resolve, reject) => {
              mediaName += '.jpeg';
              let pathToMedia = path.join(slugFolderPath, mediaName);

              let imageBuffer = api.decodeBase64Image(rawData);
              sharp(imageBuffer)
                .rotate()
                .withMetadata()
                .background({ r: 255, g: 255, b: 255 })
                .flatten()
                .jpeg({
                  quality: 90
                })
                .toFile(pathToMedia, function(err, info) {
                  if (err) {
                    dev.error(err);
                    reject(err);
                  }
                  dev.logverbose(`Stored captured image to ${pathToMedia}`);
                  resolve();
                });
            })
          );
        } else if (additionalMeta.type === 'video') {
          tasks.push(
            new Promise((resolve, reject) => {
              mediaName += '.mp4';
              let pathToMedia = path.join(slugFolderPath, mediaName);

              // only works for projects media (root) for now
              api
                .writeVideoToDisk(slugFolderName, mediaName, rawData)
                .then(() => {
                  resolve();
                })
                .catch(err => {
                  reject(err);
                });
            })
          );
        } else if (additionalMeta.type === 'audio') {
          tasks.push(
            new Promise((resolve, reject) => {
              mediaName += '.mp3';

              // only works for projects media (root) for now
              api
                .writeAudioToDisk(slugFolderName, mediaName, rawData)
                .then(() => {
                  resolve();
                })
                .catch(err => {
                  reject(err);
                });
            })
          );
        } else if (additionalMeta.type === 'svg') {
          tasks.push(
            new Promise((resolve, reject) => {
              mediaName += '.svg';
              additionalMeta.type = 'image';
              let pathToMedia = path.join(slugFolderPath, mediaName);

              var fileBuffer = new Buffer(rawData, 'base64');
              fs.writeFile(pathToMedia, fileBuffer, function(err) {
                if (err) reject(err);
                resolve();
              });
            })
          );
        } else if (additionalMeta.type === 'text') {
          tasks.push(
            new Promise((resolve, reject) => {
              mediaName += '.md';
              let pathToMedia = path.join(slugFolderPath, mediaName);

              api.storeData(pathToMedia, rawData, 'create').then(
                function(meta) {
                  resolve();
                },
                function(err) {
                  dev.error(`Failed to storeData for textmedia: ${err}`);
                  reject(err);
                }
              );
            })
          );
        }

        Promise.all(tasks)
          .then(() => {
            dev.logverbose(`Passed all tasks for captured medias`);
            let newMediaInfos = {
              media_filename: mediaName,
              fileCreationDate: api.parseDate(timeCreated)
            };
            if (typeof additionalMeta !== 'undefined') {
              newMediaInfos = Object.assign({}, newMediaInfos, additionalMeta);
            }
            resolve(newMediaInfos);
          })
          .catch(err => {
            dev.error(`Failed to store captured media as file: ${err}`);
            reject(`${err}`);
          });
      });
    }
  };

  function readMediaMeta({ type, slugFolderName, metaFileName }) {
    return new Promise(function(resolve, reject) {
      // pour chaque item, on regarde s’il contient un fichier méta (même nom + .txt)
      let slugFolderPath = api.getFolderPath(
        path.join(settings.structure[type].path, slugFolderName)
      );
      let metaFile = path.join(slugFolderPath, metaFileName);

      fs.access(metaFile, fs.F_OK, err => {
        // if there's no META file at path
        if (err) {
          dev.logverbose(`No meta for this media: ${err}`);
          return reject(`Meta is missing for ${metaFileName}`);
        }

        dev.logverbose(`Found meta there: ${metaFile}`);
        readMetaFile(metaFile)
          .then(mediaData => {
            mediaData = _sanitizeMetaFromFile({
              type,
              type_two: 'medias',
              meta: mediaData
            });

            // Legacy : if no filename in meta file when it is expected in blueprint
            // then it means its in the name of the text file
            if (
              !mediaData.hasOwnProperty('media_filename') &&
              settings.structure[type].medias.fields.hasOwnProperty(
                'media_filename'
              )
            ) {
              mediaData.media_filename = new RegExp(
                settings.regexpRemoveFileExtension,
                'i'
              ).exec(metaFileName)[1];
            }

            if (
              mediaData.type === 'text' &&
              mediaData.hasOwnProperty('media_filename')
            ) {
              // get text content
              let mediaPath = path.join(
                api.getFolderPath(slugFolderName),
                mediaData.media_filename
              );
              mediaData.content = validator.unescape(
                fs.readFileSync(mediaPath, settings.textEncoding)
              );
              dev.logverbose(`Got mediaData.content : ${mediaData.content}`);
              return resolve(mediaData);
            }
            return resolve(mediaData);
          })
          .catch(err => {
            return reject(err);
          });
      });
    });
  }
  function readMediaAndThumbs({ type, slugFolderName, metaFileName }) {
    return new Promise(function(resolve, reject) {
      dev.logfunction(
        `COMMON — readMediaAndThumbs: slugFolderName = ${slugFolderName} & metaFileName = ${metaFileName}`
      );

      readMediaMeta({ type, slugFolderName, metaFileName })
        .then(mediaData => {
          dev.logverbose(
            `Read Meta, now getting thumbs for ${JSON.stringify(
              mediaData,
              null,
              4
            )}`
          );

          if (mediaData.hasOwnProperty('media_filename')) {
            // let’s find or create thumbs
            thumbs
              .makeMediaThumbs(
                slugFolderName,
                mediaData.media_filename,
                mediaData.type
              )
              .then(thumbData => {
                mediaData.thumbs = thumbData;
                resolve(mediaData);
              })
              .catch(err => {
                resolve();
              });
          } else {
            resolve(mediaData);
          }
        })
        .catch(err => {
          resolve();
        });
    });
  }
  function readMetaFile(metaPath) {
    return new Promise(function(resolve, reject) {
      dev.logfunction(`COMMON — readMetaFile: ${metaPath}`);
      var metaFileContent = fs.readFileSync(metaPath, settings.textEncoding);
      var metaFileContentParsed = api.parseData(metaFileContent);
      resolve(metaFileContentParsed);
    });
  }
  function _getFolderSlugs(mainFolderPath) {
    return new Promise(function(resolve, reject) {
      dev.logfunction(`COMMON — _getFolderSlugs in ${mainFolderPath}`);
      fs.readdir(mainFolderPath, (err, filenames) => {
        if (err) {
          dev.logverbose(`Couldn't read content dir: ${err}`);
          return resolve([]);
        }
        if (filenames === undefined) {
          dev.error(`No folder found: ${err}`);
          return resolve([]);
        }

        var folders = filenames.filter(function(thisSlugFolderName) {
          // is a folder
          return (
            new RegExp(settings.regexpMatchFolderNames, 'i').test(
              thisSlugFolderName
            ) &&
            // if doesn’t start with _ (these folders are generated by the tool, can’t be created through the interface)
            thisSlugFolderName.indexOf('_') !== 0
          );
        });

        dev.logverbose(
          `Number of folders that match in ${mainFolderPath} = ${
            folders.length
          }. Folder(s) is(are) ${folders}`
        );
        return resolve(folders);
      });
    });
  }
  function _storeFoldersPreview(thisFolderPath, preview_rawdata) {
    return new Promise((resolve, reject) => {
      dev.logfunction(
        `COMMON — _storeFoldersPreview : will store preview for folder at path: ${thisFolderPath}`
      );
      const pathToPreview = path.join(
        thisFolderPath,
        settings.folderPreviewFilename + settings.thumbExt
      );

      dev.logverbose(
        `COMMON — _storeFoldersPreview : Removing existing preview at ${pathToPreview}`
      );
      fs
        .remove(pathToPreview)
        .then(() => {
          if (preview_rawdata === '') {
            dev.logverbose(
              `COMMON — _storeFoldersPreview : No new preview data found, returning.`
            );
            return resolve();
          }
          dev.logverbose(
            `COMMON — _storeFoldersPreview : Now making a folder preview at path ${pathToPreview}`
          );
          let imageBuffer = api.decodeBase64Image(preview_rawdata);
          sharp(imageBuffer)
            .rotate()
            .resize(600, 600)
            .max()
            .withoutEnlargement()
            .background({ r: 255, g: 255, b: 255 })
            .flatten()
            .withMetadata()
            .toFormat(settings.thumbFormat, {
              quality: settings.mediaThumbQuality
            })
            .toFile(pathToPreview)
            .then(function() {
              dev.logverbose(
                `COMMON — _storeFoldersPreview : Finished making a folder preview at ${pathToPreview}`
              );
              resolve();
            })
            .catch(err => {
              console.error(err);
              reject(err);
            });
        })
        .catch(err => {
          console.error(err);
          reject(err);
        });
    });
  }

  function _makeDefaultMetaFromStructure({
    type,
    type_two,
    method = 'create',
    existing = {}
  }) {
    dev.logfunction(
      `COMMON — _makeDefaultMetaFromStructure : will '${method}' a new default meta object for type = ${type} and type_two = ${type_two}.`
    );
    if (!settings.structure.hasOwnProperty(type)) {
      dev.error(`Missing type ${type} in settings.json`);
    }

    let fields =
      type_two === undefined
        ? settings.structure[type].fields
        : settings.structure[type][type_two].fields;
    let output_obj = {};

    Object.entries(fields).forEach(([key, val]) => {
      // dev.logverbose(`Iterating through struct entries, at key ${key}`);
      if (!val.hasOwnProperty('type')) {
        dev.error(
          `Missing type property for field name ${key} in settings.json`
        );
      }
      let type = val.type;

      // if updating and "read_only", let’s stop right there for that key
      if (
        method === 'update' &&
        val.hasOwnProperty('read_only') &&
        val.read_only === true
      ) {
        return;
      }

      // if updating a meta file and the new meta doesn’t have the iterated value
      // we stop except if that field has "override"
      if (
        method === 'update' &&
        !existing.hasOwnProperty(key) &&
        !(val.hasOwnProperty('override') && val.override === true)
      ) {
        return;
      }

      if (type === 'date') {
        // "override" means "reapply default everytime we update this file"
        if (
          (!val.hasOwnProperty('override') || val.override === false) &&
          existing.hasOwnProperty(key)
        ) {
          // get from original if it exists and if override is not set or set to false
          output_obj[key] = api.convertDate(existing[key] + '');
        } else if (val.hasOwnProperty('default')) {
          // get from default if set
          output_obj[key] =
            val.default === 'current' ? api.getCurrentDate() : val.default;
        }
      } else if (type === 'boolean') {
        if (
          (!val.hasOwnProperty('override') || val.override === false) &&
          existing.hasOwnProperty(key)
        ) {
          // get from original if it exists and if override is not set or set to false
          output_obj[key] = validator.toBoolean(existing[key] + '');
        } else if (
          val.hasOwnProperty('default') &&
          typeof val.default === 'boolean'
        ) {
          output_obj[key] = val.default;
        }
      } else if (type === 'string') {
        if (
          (!val.hasOwnProperty('override') || val.override === false) &&
          existing.hasOwnProperty(key)
        ) {
          if (val.hasOwnProperty('options')) {
            let new_val = validator.escape(existing[key] + '');
            if (val.options.includes(new_val)) {
              output_obj[key] = new_val;
            } else if (val.hasOwnProperty('default')) {
              output_obj[key] = val.default;
            }
          } else {
            output_obj[key] = validator.escape(existing[key] + '');
          }
        } else if (val.hasOwnProperty('default')) {
          output_obj[key] = val.default;
        }
      } else if (type === 'number') {
        if (
          (!val.hasOwnProperty('override') || val.override === false) &&
          existing.hasOwnProperty(key)
        ) {
          if (val.hasOwnProperty('clip')) {
            output_obj[key] = api.clip(
              validator.toFloat(existing[key] + ''),
              val.clip.min,
              val.clip.max
            );
          } else {
            output_obj[key] = validator.toFloat(existing[key] + '');
          }
        } else if (val.hasOwnProperty('default')) {
          output_obj[key] =
            val.default === 'random' ? Math.random() * 0.5 : val.default;
        }
      } else if (type === 'array') {
        if (
          (!val.hasOwnProperty('override') || val.override === false) &&
          existing.hasOwnProperty(key)
        ) {
          if (!Array.isArray(existing[key])) {
            return;
          }
          output_obj[key] = existing[key];
        } else if (val.hasOwnProperty('default')) {
          output_obj[key] = val.default;
        }
      }
    });

    dev.logverbose(
      `Finished creating output obj 
      with ${JSON.stringify(output_obj, null, 4)}`
    );

    return output_obj;
  }

  function _sanitizeMetaFromFile({ type, type_two, meta }) {
    dev.logverbose(
      `COMMON — _sanitizeMetaFromFile : 
      will sanitize a new default meta object 
      for type ${type} 
      and type_two ${type_two} 
      with existing = ${JSON.stringify(meta)}
      `
    );
    let new_meta = {};

    const fields =
      type_two === undefined
        ? settings.structure[type].fields
        : settings.structure[type][type_two].fields;

    Object.keys(meta).forEach(key => {
      if (fields.hasOwnProperty(key) && fields[key].hasOwnProperty('type')) {
        const fieldType = fields[key].type;
        if (fieldType === 'date') {
          new_meta[key] = api.parseDate(meta[key]);
        } else if (fieldType === 'string') {
          new_meta[key] = validator.unescape(meta[key]);
        } else if (fieldType === 'number') {
          new_meta[key] = validator.toFloat(meta[key]);
        } else if (fieldType === 'boolean') {
          new_meta[key] = validator.toBoolean(meta[key]);
        } else if (fieldType === 'array') {
          new_meta[key] = meta[key];
        } else {
          dev.error(`Unexpected field type ${fieldType}.`);
        }
      }
    });
    dev.logverbose(
      `COMMON — _sanitizeMetaFromFile : 
      sanitized to ${JSON.stringify(new_meta)}
      `
    );
    return new_meta;
  }

  return API;
})();
