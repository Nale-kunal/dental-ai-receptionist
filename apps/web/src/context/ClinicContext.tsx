import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import {
  formatDateInTimezone,
  formatTimeInTimezone,
  formatDateTimeInTimezone,
  toUtcIsoInTimezone,
  FormatOptions,
} from '../utils/dateTime';
import type { Clinic } from '@dental/shared';

interface ClinicContextType {
  clinic: Clinic | null;
  timezone: string;
  loading: boolean;
  refreshClinic: () => Promise<void>;
  formatDate: (dateInput: unknown, options?: FormatOptions) => string;
  formatTime: (dateInput: unknown, options?: FormatOptions) => string;
  formatDateTime: (dateInput: unknown, options?: FormatOptions) => string;
  toUtcIso: (dateStr: string, timeStr: string) => string;
}

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

export const ClinicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  // Default to user's clinicTimezone from login session if available, else standard fallback
  const [timezone, setTimezone] = useState<string>(() => {
    const user = api.getUser();
    return user?.clinicTimezone || 'America/New_York';
  });
  const [loading, setLoading] = useState<boolean>(true);

  const fetchClinic = useCallback(async () => {
    try {
      setLoading(true);
      const clinicData = await api.getClinic();
      if (clinicData) {
        setClinic(clinicData);
        if (clinicData.timezone) {
          setTimezone(clinicData.timezone);
        }
      }
    } catch (err) {
      // Fallback to user clinicTimezone from token / session if /clinic call is delayed
      const user = api.getUser();
      if (user?.clinicTimezone) {
        setTimezone(user.clinicTimezone);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClinic();
  }, [fetchClinic]);

  const formatDate = useCallback(
    (dateInput: unknown, options?: FormatOptions) => {
      return formatDateInTimezone(dateInput, timezone, options);
    },
    [timezone]
  );

  const formatTime = useCallback(
    (dateInput: unknown, options?: FormatOptions) => {
      return formatTimeInTimezone(dateInput, timezone, options);
    },
    [timezone]
  );

  const formatDateTime = useCallback(
    (dateInput: unknown, options?: FormatOptions) => {
      return formatDateTimeInTimezone(dateInput, timezone, options);
    },
    [timezone]
  );

  const toUtcIso = useCallback(
    (dateStr: string, timeStr: string) => {
      return toUtcIsoInTimezone(dateStr, timeStr, timezone);
    },
    [timezone]
  );

  return (
    <ClinicContext.Provider
      value={{
        clinic,
        timezone,
        loading,
        refreshClinic: fetchClinic,
        formatDate,
        formatTime,
        formatDateTime,
        toUtcIso,
      }}
    >
      {children}
    </ClinicContext.Provider>
  );
};

export const useClinic = (): ClinicContextType => {
  const context = useContext(ClinicContext);
  if (!context) {
    // Provide a safe fallback if used outside provider
    const user = api.getUser();
    const fallbackTz = user?.clinicTimezone || 'America/New_York';
    return {
      clinic: null,
      timezone: fallbackTz,
      loading: false,
      refreshClinic: async () => {},
      formatDate: (d, o) => formatDateInTimezone(d, fallbackTz, o),
      formatTime: (d, o) => formatTimeInTimezone(d, fallbackTz, o),
      formatDateTime: (d, o) => formatDateTimeInTimezone(d, fallbackTz, o),
      toUtcIso: (d, t) => toUtcIsoInTimezone(d, t, fallbackTz),
    };
  }
  return context;
};
