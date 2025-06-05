import assert from "assert";
import { 
  TestHelpers,
  ICHIVaultFactory_BaseFee
} from "generated";
const { MockDb, ICHIVaultFactory } = TestHelpers;

describe("ICHIVaultFactory contract BaseFee event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for ICHIVaultFactory contract BaseFee event
  const event = ICHIVaultFactory.BaseFee.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("ICHIVaultFactory_BaseFee is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await ICHIVaultFactory.BaseFee.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualICHIVaultFactoryBaseFee = mockDbUpdated.entities.ICHIVaultFactory_BaseFee.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedICHIVaultFactoryBaseFee: ICHIVaultFactory_BaseFee = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      sender: event.params.sender,
      baseFee: event.params.baseFee,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualICHIVaultFactoryBaseFee, expectedICHIVaultFactoryBaseFee, "Actual ICHIVaultFactoryBaseFee should be the same as the expectedICHIVaultFactoryBaseFee");
  });
});
