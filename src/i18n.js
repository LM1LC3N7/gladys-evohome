// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, scene action messages,
// device, feature and option names), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const DEVICE_NAMES = {
  system: { en: 'Evohome', fr: 'Evohome' },
  zone: { en: 'Zone', fr: 'Zone' },
  dhw: { en: 'Hot water', fr: 'Eau chaude' },
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  'system-mode': { en: 'System mode', fr: 'Mode du système' },
  'mode-until': { en: 'Mode until', fr: "Mode jusqu'à" },
  temperature: { en: 'Temperature', fr: 'Température' },
  'dhw-temperature': { en: 'Water temperature', fr: "Température de l'eau" },
  setpoint: { en: 'Setpoint', fr: 'Consigne' },
  'heating-mode': { en: 'Heating', fr: 'Chauffage' },
  'setpoint-mode': { en: 'Setpoint mode', fr: 'Mode de consigne' },
  'override-until': { en: 'Override until', fr: "Dérogation jusqu'à" },
  'dhw-state': { en: 'Hot water on', fr: 'Eau chaude en marche' },
  'dhw-mode': { en: 'Hot water mode', fr: "Mode de l'eau chaude" },
  'battery-low': { en: 'Battery low', fr: 'Batterie faible' },
  fault: { en: 'Fault', fr: 'Défaut' },
  faults: { en: 'Active faults', fr: 'Défauts actifs' },
};

/** Labels of the system modes (plain strings in Gladys). */
export const SYSTEM_MODE_NAMES = {
  Auto: { en: 'Auto (schedule)', fr: 'Auto (programme)' },
  AutoWithEco: { en: 'Economy', fr: 'Économie' },
  Away: { en: 'Away', fr: 'Absent' },
  DayOff: { en: 'Day off', fr: 'Jour de congé' },
  Custom: { en: 'Custom', fr: 'Personnalisé' },
  HeatingOff: { en: 'Heating off', fr: 'Chauffage arrêté' },
  AutoWithReset: { en: 'Auto, zones reset', fr: 'Auto, zones réinitialisées' },
};

export const SETPOINT_MODE_NAMES = {
  FollowSchedule: { en: 'Follow schedule', fr: 'Suit le programme' },
  PermanentOverride: { en: 'Permanent override', fr: 'Dérogation permanente' },
  TemporaryOverride: { en: 'Temporary override', fr: 'Dérogation temporaire' },
};

export const HEATING_MODE_NAMES = {
  0: { en: 'Off', fr: 'Arrêt' },
  1: { en: 'Heating', fr: 'Chauffage' },
};

export const DHW_MODE_NAMES = {
  6: { en: 'Schedule', fr: 'Programme' },
  4: { en: 'On', fr: 'Marche' },
  3: { en: 'Boost', fr: 'Boost' },
  0: { en: 'Off', fr: 'Arrêt' },
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

/** What a text feature shows when there is nothing to show. */
export const NONE = '—';

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of your Total Connect Comfort account (the one of the Evohome app).',
    fr: "Saisissez l'e-mail et le mot de passe de votre compte Total Connect Comfort (celui de l'application Evohome).",
  },
  connecting: {
    en: 'Signing in to Total Connect Comfort…',
    fr: 'Connexion à Total Connect Comfort…',
  },
  connected: (location, { zones, dhw }, others) => {
    const en = `Connected to Evohome "${location}": ${plural(zones, 'zone', 'zones')}${dhw ? ' and hot water' : ''}. Open Discovery to add them.`;
    const fr = `Connecté à Evohome « ${location} » : ${plural(zones, 'zone', 'zones')}${dhw ? ' et eau chaude' : ''}. Ouvrez Découverte pour les ajouter.`;
    if (others === 0) {
      return { en, fr };
    }
    return {
      en: `${en} The account has ${plural(others, 'other location', 'other locations')}: see "Test the connection".`,
      fr: `${fr} Le compte a ${plural(others, 'autre emplacement', 'autres emplacements')} : voir « Tester la connexion ».`,
    };
  },
  noLocation: {
    en: 'This Total Connect Comfort account has no Evohome location.',
    fr: "Ce compte Total Connect Comfort n'a aucun emplacement Evohome.",
  },
  unknownLocation: (wanted, names) => ({
    en: `No location "${wanted}" in this account (locations: ${names}). Fix the Location field.`,
    fr: `Aucun emplacement « ${wanted} » dans ce compte (emplacements : ${names}). Corrigez le champ Emplacement.`,
  }),
  refused: {
    en: 'Total Connect Comfort refused the e-mail or password: check them in the configuration (the integration waits for a change).',
    fr: "Total Connect Comfort a refusé l'e-mail ou le mot de passe : vérifiez-les dans la configuration (l'intégration attend une modification).",
  },
  expired: {
    en: 'The Total Connect Comfort session ended and the new sign-in was refused: check the e-mail and password.',
    fr: "La session Total Connect Comfort a pris fin et la nouvelle connexion a été refusée : vérifiez l'e-mail et le mot de passe.",
  },
  loginLimited: (wait) => ({
    en: `Too many sign-ins to Total Connect Comfort: Honeywell blocks new ones for a while. Next try in ${wait.en}.`,
    fr: `Trop de connexions à Total Connect Comfort : Honeywell bloque les nouvelles pendant un moment. Nouvel essai dans ${wait.fr}.`,
  }),
  unreachable: (reason, wait) => ({
    en: `Total Connect Comfort cannot be reached (${reason}). Next try in ${wait.en}.`,
    fr: `Total Connect Comfort est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
  }),
  rateLimited: (wait) => ({
    en: `Total Connect Comfort asks to slow down: pausing for ${wait.en}.`,
    fr: `Total Connect Comfort demande de ralentir : pause de ${wait.fr}.`,
  }),
  forbidden: (wait) => ({
    en: `Total Connect Comfort refuses the requests (HTTP 403): pausing for ${wait.en}.`,
    fr: `Total Connect Comfort refuse les requêtes (HTTP 403) : pause de ${wait.fr}.`,
  }),
  gatewayLost: {
    en: 'The Evohome gateway lost its connection to the cloud.',
    fr: 'La passerelle Evohome a perdu sa connexion au cloud.',
  },
  notReady: {
    en: 'The Evohome installation is not read yet: try again in a minute.',
    fr: "L'installation Evohome n'est pas encore lue : réessayez dans une minute.",
  },
  unknownDevice: {
    en: 'Unknown Evohome device: choose a system, zone or hot water of this integration.',
    fr: "Appareil Evohome inconnu : choisissez un système, une zone ou l'eau chaude de cette intégration.",
  },
  modeNotAllowed: (mode) => ({
    en: `This Evohome system does not offer the mode "${mode}".`,
    fr: `Ce système Evohome ne propose pas le mode « ${mode} ».`,
  }),
  temporaryNotAllowed: (mode) => ({
    en: `The mode "${mode}" cannot be set for a while on this system: leave the duration empty.`,
    fr: `Le mode « ${mode} » ne peut pas être réglé pour une durée sur ce système : laissez la durée vide.`,
  }),
  badSetpoint: (min, max) => ({
    en: `The setpoint must be between ${min} and ${max} °C.`,
    fr: `La consigne doit être comprise entre ${min} et ${max} °C.`,
  }),
  test: {
    cooldown: {
      en: 'Already read less than a minute ago.',
      fr: 'Déjà lu il y a moins d’une minute.',
    },
    locations: (list) => ({
      en: `Locations: ${list.en}.`,
      fr: `Emplacements : ${list.fr}.`,
    }),
    chosen: { en: 'followed', fr: 'suivi' },
    system: (mode, zones, dhw) => ({
      en: `Mode ${mode.en}, ${plural(zones, 'zone', 'zones')}${dhw ? ', hot water' : ''}.`,
      fr: `Mode ${mode.fr}, ${plural(zones, 'zone', 'zones')}${dhw ? ', eau chaude' : ''}.`,
    }),
    faults: (n) => ({
      en: n === 0 ? 'No active fault.' : `${plural(n, 'active fault', 'active faults')}.`,
      fr: n === 0 ? 'Aucun défaut actif.' : `${plural(n, 'défaut actif', 'défauts actifs')}.`,
    }),
  },
};
