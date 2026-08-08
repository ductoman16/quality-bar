{
  /**
   * @param {HTMLOListElement} list
   * @param {HTMLButtonElement} addButton
   * @param {Array<{id: string, impact: string, instruction: string}>} criteria
   */
  function createCriterionEditor(list, addButton, criteria) {
    let nextLocalIdentity = 0;
    /** @type {Array<{id?: string, impact: string, instruction: string, key: string}>} */
    let authoredCriteria = criteria.map(({ id, impact, instruction }) => ({
      id,
      impact,
      instruction,
      key: id,
    }));
    /** @type {string | null} */
    let draggedCriterionId = null;
    /** @type {Array<HTMLElement>} */
    let instructionControls = [];
    /** @type {Array<HTMLElement>} */
    let instructionErrors = [];

    /** @param {string} value */
    function option(value) {
      const element = document.createElement("option");
      element.value = value;
      element.textContent = value;
      return element;
    }

    /**
     * @param {string} criterionKey
     * @param {number} targetIndex
     * @param {"handle" | "up" | "down"} focusControl
     */
    function moveCriterion(criterionKey, targetIndex, focusControl) {
      const currentIndex = authoredCriteria.findIndex(
        ({ key }) => key === criterionKey,
      );
      if (
        currentIndex === -1 ||
        !Number.isSafeInteger(targetIndex) ||
        targetIndex < 0 ||
        targetIndex >= authoredCriteria.length
      ) {
        throw new Error("review_criterion_order_invalid");
      }
      const [criterion] = authoredCriteria.splice(currentIndex, 1);
      if (!criterion) {
        throw new Error("review_criterion_order_invalid");
      }
      authoredCriteria.splice(targetIndex, 0, criterion);
      render({ criterionKey, control: focusControl });
    }

    /**
     * @param {{criterionKey: string, control: "handle" | "instruction" | "up" | "down"}} [focus]
     */
    function render(focus) {
      /** @type {HTMLElement | undefined} */
      let focusTarget;
      instructionControls = [];
      instructionErrors = [];
      const items = authoredCriteria.map((criterion, index) => {
        const item = document.createElement("li");
        const instruction = document.createElement("textarea");
        const instructionError = document.createElement("p");
        instruction.id = `review-version-criterion-${index + 1}-instruction`;
        instruction.ariaLabel = `Criterion ${index + 1} instruction`;
        instruction.setAttribute("aria-describedby", instruction.id + "-error");
        instruction.setAttribute("aria-required", "true");
        instruction.value = criterion.instruction;
        instruction.addEventListener("input", () => {
          criterion.instruction = instruction.value;
          instructionError.hidden = true;
          instructionError.textContent = "";
        });
        instructionError.hidden = true;
        instructionError.id = instruction.id + "-error";
        instructionControls.push(instruction);
        instructionErrors.push(instructionError);

        const impact = document.createElement("select");
        impact.ariaLabel = `Criterion ${index + 1} impact`;
        impact.replaceChildren(option("advisory"), option("blocking"));
        impact.value = criterion.impact;
        impact.addEventListener("change", () => {
          criterion.impact = impact.value;
        });

        const handle = document.createElement("button");
        handle.ariaLabel = `Drag Criterion ${index + 1}`;
        handle.title = `Drag Criterion ${index + 1}`;
        handle.draggable = true;
        handle.textContent = "↕";
        handle.type = "button";
        handle.addEventListener("dragstart", (event) => {
          const dragEvent =
            /** @type {{dataTransfer?: {effectAllowed: string, setData(type: string, value: string): void}}} */ (
              event
            );
          if (!dragEvent.dataTransfer) {
            throw new Error("review_criterion_drag_invalid");
          }
          dragEvent.dataTransfer.effectAllowed = "move";
          dragEvent.dataTransfer.setData("text/plain", criterion.key);
          draggedCriterionId = criterion.key;
        });
        handle.addEventListener("dragend", () => {
          draggedCriterionId = null;
        });

        const moveUp = document.createElement("button");
        moveUp.ariaLabel = `Move Criterion ${index + 1} up`;
        moveUp.title = `Move Criterion ${index + 1} up`;
        moveUp.disabled = index === 0;
        moveUp.textContent = "↑";
        moveUp.type = "button";
        moveUp.addEventListener("click", () => {
          moveCriterion(criterion.key, index - 1, "up");
        });

        const moveDown = document.createElement("button");
        moveDown.ariaLabel = `Move Criterion ${index + 1} down`;
        moveDown.title = `Move Criterion ${index + 1} down`;
        moveDown.disabled = index === authoredCriteria.length - 1;
        moveDown.textContent = "↓";
        moveDown.type = "button";
        moveDown.addEventListener("click", () => {
          moveCriterion(criterion.key, index + 1, "down");
        });

        const retire = document.createElement("button");
        retire.ariaLabel = `Retire Criterion ${index + 1}`;
        retire.title = `Retire Criterion ${index + 1}`;
        retire.disabled = authoredCriteria.length === 1;
        retire.textContent = "−";
        retire.type = "button";
        retire.addEventListener("click", () => {
          if (
            !confirm(
              `Retire Criterion ${index + 1} from the next Review Version?`,
            )
          ) {
            return;
          }
          const retirementIndex = authoredCriteria.findIndex(
            ({ key }) => key === criterion.key,
          );
          if (retirementIndex === -1 || authoredCriteria.length === 1) {
            throw new Error("review_criterion_retirement_invalid");
          }
          authoredCriteria.splice(retirementIndex, 1);
          const focusIndex = Math.min(
            retirementIndex,
            authoredCriteria.length - 1,
          );
          const focusCriterion = authoredCriteria[focusIndex];
          if (!focusCriterion) {
            throw new Error("review_criterion_retirement_invalid");
          }
          render({
            criterionKey: focusCriterion.key,
            control: "instruction",
          });
        });

        item.addEventListener("dragover", (event) => {
          event.preventDefault();
        });
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          if (draggedCriterionId === null) {
            throw new Error("review_criterion_drag_invalid");
          }
          moveCriterion(draggedCriterionId, index, "handle");
          draggedCriterionId = null;
        });
        item.replaceChildren(
          instruction,
          instructionError,
          impact,
          handle,
          moveUp,
          moveDown,
          retire,
        );
        if (focus?.criterionKey === criterion.key) {
          if (focus.control === "handle") {
            focusTarget = handle;
          } else if (focus.control === "instruction") {
            focusTarget = instruction;
          } else if (focus.control === "up") {
            focusTarget = moveUp.disabled ? moveDown : moveUp;
          } else {
            focusTarget = moveDown.disabled ? moveUp : moveDown;
          }
        }
        return item;
      });
      list.replaceChildren(...items);
      if (focus && !focusTarget) {
        throw new Error("review_criterion_focus_invalid");
      }
      focusTarget?.focus();
    }

    render();
    addButton.addEventListener("click", () => {
      nextLocalIdentity += 1;
      const criterion = {
        impact: "advisory",
        instruction: "",
        key: `new-criterion-${nextLocalIdentity}`,
      };
      authoredCriteria.push(criterion);
      render({ criterionKey: criterion.key, control: "instruction" });
    });

    /** @param {number} index @param {string} message */
    function showInstructionFailure(index, message) {
      const control = instructionControls[index];
      const fieldError = instructionErrors[index];
      if (!control || !fieldError) {
        throw new Error("review_criterion_failure_invalid");
      }
      fieldError.textContent = message;
      fieldError.hidden = false;
      control.focus();
      return control.id;
    }

    return {
      clearErrors() {
        for (const fieldError of instructionErrors) {
          fieldError.textContent = "";
          fieldError.hidden = true;
        }
      },
      read() {
        return authoredCriteria.map(({ id, impact, instruction }) => ({
          ...(id === undefined ? {} : { id }),
          impact,
          instruction,
        }));
      },
      /** @param {string} code @param {string} message */
      showFailure(code, message) {
        if (code !== "review_criterion_instruction_invalid") {
          return undefined;
        }
        const matched =
          /^Criterion ([1-9][0-9]*) instruction must be nonblank$/.exec(
            message,
          );
        if (!matched) {
          throw new Error("review_criterion_failure_invalid");
        }
        return showInstructionFailure(Number(matched[1]) - 1, message);
      },
      validate() {
        if (authoredCriteria.length === 0) {
          return {
            code: "review_criteria_invalid",
            message: "Review must contain at least one Criterion",
          };
        }
        const index = authoredCriteria.findIndex(
          ({ instruction }) => instruction.trim().length === 0,
        );
        if (index === -1) {
          return undefined;
        }
        const message = `Criterion ${index + 1} instruction must be nonblank`;
        return {
          code: "review_criterion_instruction_invalid",
          message,
        };
      },
      /** @param {Array<{id: string, impact: string, instruction: string}>} next */
      reset(next) {
        authoredCriteria = next.map(({ id, impact, instruction }) => ({
          id,
          impact,
          instruction,
          key: id,
        }));
        draggedCriterionId = null;
        render();
      },
    };
  }

  const browserDocument =
    /** @type {Document & {qualityBarReviewCriteria?: unknown}} */ (document);
  browserDocument.qualityBarReviewCriteria = { createCriterionEditor };
}
