'use strict';
const db = require('../db');

const REPO_URL = 'http://localhost:3000/oai';
const REPO_NAME = 'KSTU Research Data Repository';

function xmlEscape(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function oaiHeader(ds) {
  return `<header>
    <identifier>oai:rdm.kstu.kg:${xmlEscape(ds.doi)}</identifier>
    <datestamp>${ds.updated ? ds.updated.slice(0,10) : ds.created.slice(0,10)}</datestamp>
  </header>`;
}

function oaiDC(ds) {
  const kw = (ds.keywords || []).map(k => `<dc:subject>${xmlEscape(k)}</dc:subject>`).join('\n    ');
  return `<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">
    <dc:title>${xmlEscape(ds.title)}</dc:title>
    <dc:creator>${xmlEscape(ds.creator?.name)}</dc:creator>
    <dc:description>${xmlEscape(ds.description)}</dc:description>
    <dc:identifier>https://doi.org/${xmlEscape(ds.doi)}</dc:identifier>
    <dc:type>Dataset</dc:type>
    <dc:rights>${xmlEscape(ds.license)}</dc:rights>
    <dc:format>${xmlEscape(ds.format)}</dc:format>
    <dc:date>${ds.created ? ds.created.slice(0,10) : ''}</dc:date>
    ${kw}
  </oai_dc:dc>`;
}

function wrap(verb, body, reqUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">
  <responseDate>${new Date().toISOString()}</responseDate>
  <request verb="${verb}">${xmlEscape(reqUrl)}</request>
  ${body}
</OAI-PMH>`;
}

module.exports = function registerOaiRoute(route) {
  route('GET', '/oai', (req, res, q) => {
    const verb = q.verb || '';
    const datasets = db.getAllDatasets().filter(d => d.status === 'published');

    res.setHeader('Content-Type', 'text/xml;charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (verb === 'Identify') {
      res.writeHead(200);
      return res.end(wrap('Identify', `<Identify>
        <repositoryName>${xmlEscape(REPO_NAME)}</repositoryName>
        <baseURL>${REPO_URL}</baseURL>
        <protocolVersion>2.0</protocolVersion>
        <adminEmail>admin@kstu.kg</adminEmail>
        <earliestDatestamp>2024-01-01</earliestDatestamp>
        <deletedRecord>no</deletedRecord>
        <granularity>YYYY-MM-DD</granularity>
      </Identify>`, REPO_URL));
    }

    if (verb === 'ListMetadataFormats') {
      res.writeHead(200);
      return res.end(wrap('ListMetadataFormats', `<ListMetadataFormats>
        <metadataFormat>
          <metadataPrefix>oai_dc</metadataPrefix>
          <schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema>
          <metadataNamespace>http://www.openarchives.org/OAI/2.0/oai_dc/</metadataNamespace>
        </metadataFormat>
      </ListMetadataFormats>`, REPO_URL));
    }

    if (verb === 'ListIdentifiers') {
      const mPrefix = q.metadataPrefix || 'oai_dc';
      if (mPrefix !== 'oai_dc') {
        res.writeHead(200);
        return res.end(wrap('ListIdentifiers', '<error code="cannotDisseminateFormat">Unsupported prefix</error>', REPO_URL));
      }
      const headers = datasets.map(ds => `<header>${oaiHeader(ds).slice(8,-9)}</header>`).join('\n');
      res.writeHead(200);
      return res.end(wrap('ListIdentifiers', `<ListIdentifiers>${headers}</ListIdentifiers>`, REPO_URL));
    }

    if (verb === 'ListRecords') {
      const mPrefix = q.metadataPrefix || 'oai_dc';
      if (mPrefix !== 'oai_dc') {
        res.writeHead(200);
        return res.end(wrap('ListRecords', '<error code="cannotDisseminateFormat">Unsupported prefix</error>', REPO_URL));
      }
      const records = datasets.map(ds => `<record>
        ${oaiHeader(ds)}
        <metadata>${oaiDC(ds)}</metadata>
      </record>`).join('\n');
      res.writeHead(200);
      return res.end(wrap('ListRecords', `<ListRecords>${records}${datasets.length === 0 ? '<error code="noRecordsMatch">No records</error>' : ''}</ListRecords>`, REPO_URL));
    }

    if (verb === 'GetRecord') {
      const identifier = q.identifier || '';
      const doi = identifier.replace('oai:rdm.kstu.kg:', '');
      const ds = datasets.find(d => d.doi === doi);
      if (!ds) {
        res.writeHead(200);
        return res.end(wrap('GetRecord', '<error code="idDoesNotExist">No such record</error>', REPO_URL));
      }
      res.writeHead(200);
      return res.end(wrap('GetRecord', `<GetRecord><record>${oaiHeader(ds)}<metadata>${oaiDC(ds)}</metadata></record></GetRecord>`, REPO_URL));
    }

    // Unknown verb
    res.writeHead(200);
    res.end(wrap('', '<error code="badVerb">Illegal OAI verb</error>', REPO_URL));
  });
};
