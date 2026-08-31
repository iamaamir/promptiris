import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const readRegularEvidenceFile = async (path, noFollowFlag = constants.O_NOFOLLOW) => {
  if (typeof noFollowFlag !== 'number')
    throw new Error('the platform cannot open evidence without following symlinks');
  const file = await open(path, constants.O_RDONLY | noFollowFlag);
  try {
    if (!(await file.stat()).isFile()) throw new Error('evidence is not a regular file');
    return await file.readFile();
  } finally {
    await file.close();
  }
};
