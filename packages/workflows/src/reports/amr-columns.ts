/** Antibiotic substances pivoted long→wide (from sp_Ndola_ast_data_month PIVOT). */
export const AMR_ANTIBIOTICS = [
  'Amikacin', 'Amoxycillin', 'Amoxycillin/Clavulanic acid', 'Ampicillin', 'Ampicillin/Sulbactum',
  'Azithromycin', 'Carbenicillin', 'Cefazolin', 'Cefepime', 'Cefotaxime', 'Cefoxitin Screen',
  'Ceftazidime', 'Ceftriaxone', 'Cefuroxime', 'Cefuroxime (oral)', 'Cefuroxime (Parenteral)',
  'Cefuroxime Axetil', 'Cephalothin', 'Chloramphenicol', 'Ciprofloxacin', 'Clarithromycin',
  'Clindamycin', 'Co-amoxiclav', 'Co-trimoxazole', 'Colistin', 'Doripenem', 'Doxycycline',
  'Ertapenem', 'Erythromycin', 'Gentamicin', 'Imipenem', 'Levofloxacin', 'Linezolid', 'Meropenem',
  'Minocycline', 'Moxifloxacin', 'Nalidixic Acid', 'Nitrofurantoin', 'Norfloxacin', 'Oxacillin',
  'Penicillin', 'Piperacillin', 'Piperacillin/Tazobactam', 'Polymyxin B', 'Quinupristin/Dalfopristin',
  'Rifampicin', 'Tetracycline', 'Ticarcillin', 'Tigecycline', 'Tobramycin', 'Trimethoprim',
  'Trimethoprim/Sulfamethoxazole', 'Vancomycin', 'Gram Results',
] as const;

/** Full AMR_temp.xlsx column order (A→BV) from temp/app.js. */
export const AMR_TEMPLATE_COLUMNS = [
  'cultureTestCode', 'CultureTestDescription', 'LIMSRptResult', 'RequestID', 'LIMSSpecimenSourceCode',
  'LIMSSpecimenSourceDesc', 'IdentificationNumber', 'AccessionDate', 'SpecimenDate', 'FIRSTNAME',
  'LastName', 'AgeInYears', 'DOB', 'sex', 'LocationCode', 'Location', 'AST_TestCode', 'AST_Test',
  'ORGANISM', 'Gram Results',
  ...AMR_ANTIBIOTICS.filter((a) => a !== 'Gram Results'),
  'Comment',
] as const;
