import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import * as ctrl from './appointments.controller';

export const appointmentsRouter = Router();

// All appointment routes require authentication
appointmentsRouter.use(authenticate);

// Dashboard metrics (clinic-scoped)
appointmentsRouter.get('/metrics', ctrl.getDashboardMetrics);

// Appointment CRUD
appointmentsRouter.get('/', ctrl.listAppointments);
appointmentsRouter.post('/', ctrl.bookAppointment);
appointmentsRouter.get('/:id', ctrl.getAppointment);
appointmentsRouter.post('/:id/cancel', ctrl.cancelAppointment);
appointmentsRouter.post('/:id/reschedule', ctrl.rescheduleAppointment);
appointmentsRouter.get('/:id/history', ctrl.getAppointmentHistory);
