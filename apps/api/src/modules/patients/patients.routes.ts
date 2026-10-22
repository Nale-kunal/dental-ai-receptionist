import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import * as ctrl from './patients.controller';

export const patientsRouter = Router();
patientsRouter.use(authenticate);

patientsRouter.get('/', ctrl.listPatients);
patientsRouter.post('/', ctrl.createPatient);
patientsRouter.get('/:id', ctrl.getPatient);
patientsRouter.patch('/:id', ctrl.updatePatient);
patientsRouter.get('/:id/appointments', ctrl.getPatientAppointments);
