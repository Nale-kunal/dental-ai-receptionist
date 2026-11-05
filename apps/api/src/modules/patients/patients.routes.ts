import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import * as ctrl from './patients.controller';

export const patientsRouter = Router();
patientsRouter.use(authenticate);

patientsRouter.get('/', ctrl.listPatients);
patientsRouter.get('/archived/count', ctrl.getArchivedCount);
patientsRouter.get('/archived', ctrl.listArchivedPatients);
patientsRouter.post('/', ctrl.createPatient);
patientsRouter.get('/:id', ctrl.getPatient);
patientsRouter.patch('/:id', ctrl.updatePatient);
patientsRouter.post('/:id/archive', ctrl.archivePatient);
patientsRouter.post('/:id/restore', ctrl.restorePatient);
patientsRouter.get('/:id/appointments', ctrl.getPatientAppointments);
