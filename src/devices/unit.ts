/**
 * SmartRent unit (apartment) and hub data returned by the /units API.
 */
export type UnitData = {
  building: string;
  city: string;
  country: string | null;
  floor: string;
  group: {
    city: string;
    country: string;
    group_white_label_config: null;
    id: number;
    marketing_name: string;
    organization_id: number;
    parking_enabled: false;
    property_code: string;
    rentcafe_id: null;
    state: string;
    store_url: null;
    street_address_1: string;
    street_address_2: string;
    sync_interval: number;
    temperature_scale: string;
    timezone: string;
    uuid: string;
    zip: string;
  };
  group_id: number;
  has_hub: boolean;
  hub: {
    connected_to_community_wifi: boolean;
    connection: string;
    firmware: string;
    hub_account_id: number;
    id: number;
    online: number;
    serial: string;
    timezone: null;
    type: string;
    unit_id: number;
    wifi_supported: boolean;
  };
  hub_id: number;
  id: number;
  image_url: string;
  marketing_name: string;
  parking_enabled: boolean;
  portal_only: boolean;
  ring_enabled: boolean;
  state: string;
  street_address_1: string;
  street_address_2: string;
  temperature_scale: string;
  timezone: string;
  unit_code: string;
  zip: string;
};

export type UnitRecords = {
  current_page: 1;
  records: UnitData[];
  total_pages: 1;
  total_records: 1;
};
