describe("Worklist to report lifecycle", () => {
  it("assigns study then marks reported and verifies TAT visibility", () => {
    // Assumes local stack and seeded mock data exist.
    cy.visit("/worklist");

    cy.contains("Study Worklist").should("be.visible");
    cy.get("table tbody tr").first().within(() => {
      cy.get('input[type="checkbox"]').first().check({ force: true });
    });

    cy.get("select").first().select(1);
    cy.contains("Assign selected").click();

    cy.get("table tbody tr").first().within(() => {
      cy.contains("Report").click();
    });

    cy.contains("Report Editor").should("be.visible");
    cy.contains("Mark Reported").click();
    cy.contains("Study marked as reported").should("be.visible");

    cy.visit("/worklist");
    cy.contains("TAT (h)").should("be.visible");
  });
});
