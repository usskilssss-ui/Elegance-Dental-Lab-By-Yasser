const {
  ingestAndMatch,
  confirmMatch,
  syncCaseById,
  getCaseExocadView,
  parseDentalProjectXml,
} = require('../services/exocad/exocadSyncService');
const ExocadDoctorMapping = require('../models/ExocadDoctorMapping');
const ExocadIngest = require('../models/ExocadIngest');

function requireAgentSecret(req, res, next) {
  const secret = req.headers['x-agent-secret'];
  const expected = process.env.EXOCAD_AGENT_SECRET || process.env.PRINT_AGENT_SECRET;
  if (!expected || !secret || secret !== expected) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }
  return next();
}

exports.ingest = async (req, res) => {
  try {
    const body = req.body || {};
    const result = await ingestAndMatch(
      body.xmlContent
        ? {
            xmlContent: body.xmlContent,
            sourceFile: body.sourceFile || '',
            projectFolder: body.projectFolder || '',
          }
        : body
    );
    return res.json({
      success: true,
      status: result.status,
      message: result.message || '',
      candidates: result.candidates || [],
      exocadCaseId: result.ingest?.exocadCaseId,
      matchedCaseId: result.ingest?.matchedCaseId || null,
      error: result.error || '',
    });
  } catch (error) {
    console.error('[exocad.ingest]', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Exocad ingest failed',
    });
  }
};

exports.parsePreview = async (req, res) => {
  try {
    const parsed = parseDentalProjectXml(req.body?.xmlContent || '', {
      sourceFile: req.body?.sourceFile,
      projectFolder: req.body?.projectFolder,
    });
    return res.json({ success: true, data: parsed });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.requireAgentSecret = requireAgentSecret;

exports.getCaseStatus = async (req, res) => {
  try {
    const view = await getCaseExocadView(req.params.caseId);
    if (!view) {
      return res.status(404).json({ success: false, message: 'الحالة غير موجودة' });
    }
    return res.json({ success: true, data: view });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncCase = async (req, res) => {
  try {
    const result = await syncCaseById(req.params.caseId);
    if (!result.ok) {
      const code =
        result.error === 'CASE_EXITED_LOCKED'
          ? 409
          : result.error === 'CASE_NOT_FOUND'
            ? 404
            : 400;
      return res.status(code).json({
        success: false,
        message:
          result.error === 'CASE_EXITED_LOCKED'
            ? 'الحالات الخارجة لا تُعدَّل'
            : result.error || 'تعذر المزامنة',
        data: result,
      });
    }
    const view = await getCaseExocadView(req.params.caseId);
    const sheet = result.sheet || result.applied?.sheet || null;
    return res.json({
      success: true,
      data: view,
      sheet,
      message: sheet?.applied
        ? `تم تحديث الشيت: كمية ${sheet.quantity} / أسنان ${
            Array.isArray(sheet.teeth) ? sheet.teeth.length : 0
          }`
        : sheet?.reason
          ? `المزامنة تمت لكن الشيت لم يُحدَّث (${sheet.reason})`
          : 'تمت المزامنة',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.confirmCaseMatch = async (req, res) => {
  try {
    const { exocadCaseId } = req.body || {};
    if (!exocadCaseId) {
      return res.status(400).json({ success: false, message: 'exocadCaseId مطلوب' });
    }
    const result = await confirmMatch(req.params.caseId, exocadCaseId);
    if (!result.ok) {
      const code = result.error === 'CASE_EXITED_LOCKED' ? 409 : 400;
      return res.status(code).json({
        success: false,
        message:
          result.error === 'CASE_EXITED_LOCKED'
            ? 'الحالات الخارجة لا تُعدَّل'
            : result.error || 'تعذر التأكيد',
      });
    }
    const view = await getCaseExocadView(req.params.caseId);
    return res.json({ success: true, data: view });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listIngests = async (req, res) => {
  try {
    const filter = req.query.status ? { syncStatus: String(req.query.status) } : {};
    const rows = await ExocadIngest.find(filter).sort({ lastIngestedAt: -1 }).limit(100).lean();
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listDoctorMappings = async (req, res) => {
  try {
    const rows = await ExocadDoctorMapping.find().sort({ internalDoctorName: 1 }).lean();
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertDoctorMapping = async (req, res) => {
  try {
    const internalDoctorName = String(req.body?.internalDoctorName || '').trim();
    if (!internalDoctorName) {
      return res.status(400).json({ success: false, message: 'اسم الدكتور مطلوب' });
    }
    const exocadNames = Array.isArray(req.body?.exocadNames)
      ? req.body.exocadNames.map((n) => String(n).trim()).filter(Boolean)
      : String(req.body?.exocadName || '')
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);

    const row = await ExocadDoctorMapping.findOneAndUpdate(
      { internalDoctorName },
      {
        $set: {
          internalDoctorName,
          exocadNames,
          doctorUserId: req.body?.doctorUserId || null,
          active: req.body?.active !== false,
          notes: String(req.body?.notes || '').trim(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, data: row });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDoctorMapping = async (req, res) => {
  try {
    await ExocadDoctorMapping.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
