const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const searchFlights = async () => {
    // 1. Your dynamic search parameters
    const searchParams = {
        from: "LOS", // Lagos
        to: "ABV",   // Abuja
        dateOut: "2026-04-15",
        dateIn: "2026-04-22"
    };

    const soapEnvelope = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://www.opentravel.org/OTA/2003/05">
        <soapenv:Header />
        <soapenv:Body>
            <OTA_AirLowFareSearchRQ TimeStamp="${new Date().toISOString()}" Target="Production" Version="1.0" PrimaryLangID="en">  
                <POS>
                    <Source ISOCountry="NG" ISOCurrency="NGN">
                        <RequestorID Type="Company" ID="website" ID_Context="ts" MessagePassword="${process.env.TS_PASSWORD}">
                            <CompanyName>${process.env.TS_USER}</CompanyName>
                        </RequestorID>
                    </Source>
                </POS>  
                <OriginDestinationInformation RefNumber="0"> 
                    <DepartureDateTime>${searchParams.dateOut}T00:00:00</DepartureDateTime>  
                    <OriginLocation LocationCode="${searchParams.from}" CodeContext="airport">${searchParams.from}</OriginLocation>  
                    <DestinationLocation LocationCode="${searchParams.to}" CodeContext="city">${searchParams.to}</DestinationLocation> 
                </OriginDestinationInformation>  
                <OriginDestinationInformation RefNumber="1"> 
                    <DepartureDateTime>${searchParams.dateIn}T00:00:00</DepartureDateTime>  
                    <OriginLocation LocationCode="${searchParams.to}" CodeContext="city">${searchParams.to}</OriginLocation>  
                    <DestinationLocation LocationCode="${searchParams.from}" CodeContext="airport">${searchParams.from}</DestinationLocation> 
                </OriginDestinationInformation>  
                <TravelPreferences> 
                    <CabinPref PreferLevel="Preferred" Cabin="Economy"/> 
                </TravelPreferences>  
                <TravelerInfoSummary> 
                    <AirTravelerAvail> 
                        <PassengerTypeQuantity Code="10" Quantity="1"/> 
                    </AirTravelerAvail> 
                </TravelerInfoSummary> 
            </OTA_AirLowFareSearchRQ> 
        </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        console.log("Searching for flights...");

        const response = await axios.post(process.env.TS_ENDPOINT, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml',
                'SOAPAction': 'OTA_AirLowFareSearch'
            },
            timeout: 30000 // Searches are slow; give it 30s
        });

        // 2. Parse XML to JSON
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(response.data);

        // 3. Log the formatted response
        console.log("--- SEARCH RESULTS ---");
        console.dir(result, { depth: null }); // Allows you to see deep nested objects

    } catch (error) {
        if (error.response) {
            console.error("Server Error Response:", error.response.data);
        } else {
            console.error("Request Error:", error.message);
        }
    }
};

searchFlights();