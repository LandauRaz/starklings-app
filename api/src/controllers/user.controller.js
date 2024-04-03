import util from 'util';
import fs from 'fs';
import toml from '@iarna/toml';
import { exec } from 'child_process';
import path from 'path';
import { pool } from "../db.js";

const accessAsync = util.promisify(fs.access);
const writeFileAsync = util.promisify(fs.writeFile);
const readFileAsync = util.promisify(fs.readFile);

export const getExercisesByUser = async (req, res, next) => {
    const user = req.params.user;
    const result = await pool.query("SELECT * FROM Resolutions WHERE user_name = $1", [user]);
    return res.json(result.rows);
};

export const matchUser = async (req, res, next) => {
    const user = req.params.user;
    const newUser = req.params.newUser;

    await pool.query("UPDATE resolutions SET user_name = $1 WHERE user_name = $2", [newUser, user]);
    return res.status(200).json({ message: 'ok' });
};

export const resolveExercise = async (req, res, next) => {
    const content = req.body;
    const user = req.params.user;
    const exercise_id = req.params.exercise;

    if (Object.keys(content).length == 0) {
        return res.status(500).json({ statusCode: 500, message: 'Error body is empty' });
    }

    let response;
    try {
        response = await readFileAsync('info.toml', 'utf8');
    } catch (error) {
        throw { statusCode: 500, message: 'Error al leer el archivo2' };
    }
    let result = toml.parse(response);

    let exercise;
    for (const objeto of result.exercises) {
        if (objeto.id === exercise_id) {
            exercise = objeto;
            break;
        }
    }

    const rootDir = process.cwd();
    const tempFolder = path.join(rootDir, 'temp');
    const destinationFolder = path.join(tempFolder, user);

    try {
        if (!await existFolder(destinationFolder)) {
            await executeScarbNew(user, tempFolder);
        }
        await replaceCode(destinationFolder, content);
        let log;
        if (exercise.mode === 'run') {
            log = await executeScarbRun(destinationFolder);
        } else {
            log = await executeScarbTest(destinationFolder);
        }

        await pool.query("INSERT INTO Resolutions (user_name, exercise_id) VALUES ($1, $2) ON CONFLICT (user_name, exercise_id) DO NOTHING", [
            user, exercise_id
        ]);

        return res.status(200).json({ message: log });
    } catch (error) {
        return next(error);
    }
};

async function existFolder(folderName) {
    try {
        await accessAsync(folderName, fs.constants.F_OK);
        return true;
    } catch (err) {
        return false;
    }
}

async function executeScarbNew(folderName, tempFolder) {
    try {
        await util.promisify(exec)(`scarb new ${folderName}`, { cwd: tempFolder });
    } catch (error) {
        throw { statusCode: 500, message: 'Error executing scarb new' };
    }
}

async function replaceCode(destinationFolder, content) {
    const srcFolder = path.join(destinationFolder, 'src');
    const libCairoFile = path.join(srcFolder, 'lib.cairo');
    try {
        await writeFileAsync(libCairoFile, content);
    } catch (error) {
        throw { statusCode: 500, message: 'Error writing to file' };
    }
}

async function executeScarbRun(destinationFolder) {
    try {
        const { stdout } = await util.promisify(exec)(`scarb cairo-run`, { cwd: destinationFolder });
        return stdout;
    } catch (error) {
        throw { statusCode: 500, message: error.stdout };
    }
}

async function executeScarbTest(destinationFolder) {
    try {
        const { stdout } = await util.promisify(exec)(`scarb test`, { cwd: destinationFolder });
        return stdout;
    } catch (error) {
        throw { statusCode: 500, message: error.stdout };
    }
}
