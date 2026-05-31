import { VtuController } from "./vtu.controller";

describe("VtuController", () => {
  const vtuService = {
    autoDetectReloadlyOperator: jest.fn(),
  };

  let controller: VtuController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new VtuController(vtuService as any);
  });

  it("delegates Reloadly operator auto-detect queries to the service", async () => {
    vtuService.autoDetectReloadlyOperator.mockResolvedValue({
      id: "342",
      name: "Airtel Nigeria",
      type: "airtime",
      isActive: true,
      countryCode: "NG",
    });

    await expect(
      controller.autoDetectOperator({
        phone: "+2348012345678",
        countryCode: "NG",
        type: "airtime",
      }),
    ).resolves.toEqual({
      id: "342",
      name: "Airtel Nigeria",
      type: "airtime",
      isActive: true,
      countryCode: "NG",
    });
    expect(vtuService.autoDetectReloadlyOperator).toHaveBeenCalledWith({
      phone: "+2348012345678",
      countryCode: "NG",
      type: "airtime",
    });
  });
});
