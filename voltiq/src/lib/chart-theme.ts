export const darkChartPalette = {
  observed: "#45DFF5",
  forecast: "#A6A4FF",
  reference: "#A0B2C6",
  candidate: "#F4BB62",
};
export function chartPalette(light: boolean) {
  return light
    ? {
        observed: "#087B91",
        forecast: "#625AC0",
        reference: "#4B6075",
        candidate: "#986007",
      }
    : darkChartPalette;
}
