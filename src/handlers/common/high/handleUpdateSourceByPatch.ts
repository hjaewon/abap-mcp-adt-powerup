/**
 * UpdateSourceByPatch Handler - Surgical string-replacement edit of existing
 * ABAP source on SAP (like a find-and-replace patch), instead of resending
 * the entire source.
 *
 * Flow:
 *   1. Fetch the CURRENT source of the object.
 *   2. Find old_string in it (error if missing, error if ambiguous unless
 *      replace_all is set).
 *   3. Apply the replacement to produce the new full source.
 *   4. Delegate the write to the EXISTING high-level Update* handler for
 *      that object type (handleUpdateClass / handleUpdateProgram /
 *      handleUpdateInterface / handleUpdateInclude /
 *      handleUpdateFunctionModule), so lock/syntax-check/unlock/activate
 *      behavior stays byte-for-byte identical to calling that tool directly.
 *
 * Modifies source code on SAP (via the delegated handler) when it succeeds.
 */

import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  applySourcePatch,
  buildDiffPreview,
  type SourcePatchResult,
} from '../../../lib/sourcePatch';
import {
  type AxiosResponse,
  ErrorCode,
  McpError,
  return_error,
  return_response,
} from '../../../lib/utils';
import { handleUpdateClass } from '../../class/high/handleUpdateClass';
import { handleUpdateFunctionModule } from '../../function/high/handleUpdateFunctionModule';
import { handleUpdateInclude } from '../../include/high/handleUpdateInclude';
import { handleGetInclude } from '../../include/readonly/handleGetInclude';
import { handleUpdateInterface } from '../../interface/high/handleUpdateInterface';
import { handleUpdateProgram } from '../../program/high/handleUpdateProgram';

export const TOOL_DEFINITION = {
  name: 'UpdateSourceByPatch',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Modify existing ABAP source code on SAP via a surgical string replacement (find old_string, replace with new_string) instead of resending the full source. ' +
    'Fetches the current source, applies the patch, then delegates the write to the same lock -> syntax-check -> update -> unlock -> (activate) flow used by ' +
    'UpdateClass/UpdateProgram/UpdateInterface/UpdateInclude/UpdateFunctionModule. Supported object_type values: CLAS (class), PROG (program, on-premise/legacy only), ' +
    'INTF (interface), INCL (include, on-premise/legacy only), FUNC (function module, requires function_group). ' +
    'old_string must match the current source exactly, including whitespace, and must be unique unless replace_all is true.',
  inputSchema: {
    type: 'object',
    properties: {
      object_type: {
        type: 'string',
        enum: ['CLAS', 'PROG', 'INTF', 'INCL', 'FUNC'],
        description:
          'ABAP object kind to patch: CLAS (class), PROG (program), INTF (interface), INCL (include), FUNC (function module).',
      },
      object_name: {
        type: 'string',
        description: 'Name of the object to patch (e.g., ZCL_MY_CLASS).',
      },
      function_group: {
        type: 'string',
        description:
          "Function group name. Required when object_type is 'FUNC'.",
      },
      old_string: {
        type: 'string',
        description:
          'Exact text to find in the current source (whitespace-sensitive). Must match exactly once unless replace_all is true.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text.',
      },
      replace_all: {
        type: 'boolean',
        description:
          'Replace every occurrence of old_string instead of requiring a unique match. Default: false.',
      },
      transport_request: {
        type: 'string',
        description:
          'Transport request number, passed through to the delegated update handler.',
      },
      activate: {
        type: 'boolean',
        description:
          'Activate the object after the patched source is written. Default: false.',
      },
    },
    required: ['object_type', 'object_name', 'old_string', 'new_string'],
  },
} as const;

type PatchObjectType = 'CLAS' | 'PROG' | 'INTF' | 'INCL' | 'FUNC';

function extractReadSource(
  readResult: any,
  objectName: string,
  label: string,
): string {
  const data = readResult?.readResult?.data;
  if (data === undefined || data === null) {
    throw new Error(`${label} ${objectName} not found or has no source`);
  }
  return typeof data === 'string' ? data : JSON.stringify(data);
}

async function fetchCurrentSource(
  context: HandlerContext,
  objectType: PatchObjectType,
  objectName: string,
  functionGroup: string | undefined,
): Promise<string> {
  const { connection, logger } = context;

  if (objectType === 'INCL') {
    const includeResult = await handleGetInclude(context, {
      include_name: objectName,
    });
    if (includeResult.isError) {
      throw new Error(
        `Failed to fetch current source for include ${objectName}: ${includeResult.content?.[0]?.text ?? 'unknown error'}`,
      );
    }
    return String(includeResult.content?.[0]?.text ?? '');
  }

  const client = createAdtClient(connection, logger);

  if (objectType === 'CLAS') {
    const readResult = await client
      .getClass()
      .read({ className: objectName }, 'active');
    return extractReadSource(readResult, objectName, 'Class');
  }
  if (objectType === 'PROG') {
    const readResult = await client
      .getProgram()
      .read({ programName: objectName }, 'active');
    return extractReadSource(readResult, objectName, 'Program');
  }
  if (objectType === 'INTF') {
    const readResult = await client
      .getInterface()
      .read({ interfaceName: objectName }, 'active');
    return extractReadSource(readResult, objectName, 'Interface');
  }

  // FUNC
  if (!functionGroup) {
    throw new Error('function_group is required when object_type is FUNC');
  }
  const readResult = await client
    .getFunctionModule()
    .read(
      { functionModuleName: objectName, functionGroupName: functionGroup },
      'active',
    );
  return extractReadSource(readResult, objectName, 'Function module');
}

async function delegateUpdate(
  context: HandlerContext,
  objectType: PatchObjectType,
  objectName: string,
  functionGroup: string | undefined,
  newSource: string,
  transportRequest: string | undefined,
  activate: boolean,
): Promise<any> {
  switch (objectType) {
    case 'CLAS':
      return handleUpdateClass(context, {
        class_name: objectName,
        source_code: newSource,
        transport_request: transportRequest,
        activate,
      });
    case 'PROG':
      return handleUpdateProgram(context, {
        program_name: objectName,
        source_code: newSource,
        transport_request: transportRequest,
        activate,
      });
    case 'INTF':
      return handleUpdateInterface(context, {
        interface_name: objectName,
        source_code: newSource,
        transport_request: transportRequest,
        activate,
      });
    case 'INCL':
      return handleUpdateInclude(context, {
        include_name: objectName,
        source_code: newSource,
        transport_request: transportRequest,
        activate,
      });
    case 'FUNC':
      return handleUpdateFunctionModule(context, {
        function_group_name: functionGroup as string,
        function_module_name: objectName,
        source_code: newSource,
        transport_request: transportRequest,
        activate,
      });
  }
}

export async function handleUpdateSourceByPatch(
  context: HandlerContext,
  args: any,
) {
  const { logger } = context;
  try {
    const {
      object_type,
      object_name,
      function_group,
      old_string,
      new_string,
      replace_all,
      transport_request,
      activate,
    } = args ?? {};

    if (
      !object_type ||
      !object_name ||
      old_string === undefined ||
      new_string === undefined
    ) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'object_type, object_name, old_string, and new_string are required',
      );
    }

    const validTypes: PatchObjectType[] = [
      'CLAS',
      'PROG',
      'INTF',
      'INCL',
      'FUNC',
    ];
    if (!validTypes.includes(object_type)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unsupported object_type '${object_type}'. Must be one of: ${validTypes.join(', ')}`,
      );
    }

    if (object_type === 'FUNC' && !function_group) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'function_group is required when object_type is FUNC',
      );
    }

    const objectName = String(object_name).toUpperCase();
    const functionGroup = function_group
      ? String(function_group).toUpperCase()
      : undefined;
    const shouldReplaceAll = replace_all === true;
    const shouldActivate = activate === true;

    logger?.info(
      `UpdateSourceByPatch: object_type=${object_type}, object_name=${objectName}, replace_all=${shouldReplaceAll}, activate=${shouldActivate}`,
    );

    // Step 1: fetch current source
    const currentSource = await fetchCurrentSource(
      context,
      object_type,
      objectName,
      functionGroup,
    );

    // Step 2: locate + apply patch (pure logic; throws on not-found / not-unique)
    let patch: SourcePatchResult;
    try {
      patch = applySourcePatch(
        currentSource,
        old_string,
        new_string,
        shouldReplaceAll,
      );
    } catch (patchError: any) {
      return return_error(
        new Error(
          `${patchError.message} (object: ${object_type} ${objectName})`,
        ),
      );
    }

    // Step 3: compact diff preview around the first replaced region
    const diffPreview = buildDiffPreview(
      currentSource,
      patch.newSource,
      patch.firstMatchIndex,
      old_string,
      new_string,
    );

    // Step 4: delegate the write to the existing high-level update handler,
    // preserving that handler's lock -> syntax-check -> update -> unlock ->
    // (activate) flow exactly.
    const delegateResult = await delegateUpdate(
      context,
      object_type,
      objectName,
      functionGroup,
      patch.newSource,
      transport_request,
      shouldActivate,
    );

    if (delegateResult?.isError) {
      // Surface the delegated handler's error as-is (already includes full
      // syntax-check diagnostics, lock failures, etc.) so the caller can fix
      // and retry.
      return delegateResult;
    }

    let activated = shouldActivate;
    let checkWarnings: unknown;
    try {
      const delegateText = delegateResult?.content?.[0]?.text;
      const delegatePayload =
        typeof delegateText === 'string' ? JSON.parse(delegateText) : undefined;
      if (delegatePayload) {
        if (typeof delegatePayload.activated === 'boolean') {
          activated = delegatePayload.activated;
        }
        if (delegatePayload.check_warnings) {
          checkWarnings = delegatePayload.check_warnings;
        }
      }
    } catch {
      // Delegate response wasn't JSON — keep the computed defaults.
    }

    const result = {
      success: true,
      object_type,
      object_name: objectName,
      function_group: functionGroup,
      occurrences_replaced: patch.occurrences,
      diff_preview: diffPreview,
      activated,
      check_warnings: checkWarnings,
      message: `${object_type} ${objectName} patched (${patch.occurrences} occurrence${patch.occurrences === 1 ? '' : 's'} replaced)${activated ? ' and activated' : ''}`,
    };

    return return_response({
      data: JSON.stringify(result, null, 2),
    } as AxiosResponse);
  } catch (error: any) {
    logger?.error(`UpdateSourceByPatch failed: ${error?.message || error}`);
    return return_error(error);
  }
}
